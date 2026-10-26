import PQueue from '@esm2cjs/p-queue';
import { withQueryAttribution } from '@hyperdx/common-utils/dist/clickhouse/node';
import { serializeError } from 'serialize-error';

import { IWebhook } from '@/models/webhook';
import {
  AlertProvider,
  AlertTask,
  loadProvider,
} from '@/tasks/checkAlerts/providers';
import { tasksTracer } from '@/tasks/tracer';
import { CheckAlertsTaskArgs, HdxTask } from '@/tasks/types';
import {
  getCounter,
  setBusinessContext,
  SpanStatusCode,
  withSpan,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';

import { alertQueryAttribution, getErrorMessage, processAlert } from '.';

const alertBatchFailuresCounter = getCounter('hyperdx.alerts.batch_failures', {
  description:
    'Count of alert batches (one per connection) that failed before their alerts could be evaluated, e.g. a ClickHouse connection failure.',
});

export default class CheckAlertTask implements HdxTask {
  private provider!: AlertProvider;
  private task_queue: PQueue;

  constructor(private args: CheckAlertsTaskArgs) {
    const concurrency = this.args.concurrency;
    this.task_queue = new PQueue({
      autoStart: true,
      ...(concurrency ? { concurrency } : null),
    });
  }

  /**
   * Schedules every alert in one connection's batch onto the task queue.
   *
   * @returns true if the batch was scheduled, false if it failed.
   */
  async processAlertTask(
    alertTask: AlertTask,
    teamWebhooksById: Map<string, IWebhook>,
  ): Promise<boolean> {
    return tasksTracer.startActiveSpan('processAlertTask', async span => {
      setBusinessContext({ teamId: alertTask.conn.team.toString() });
      try {
        span.setAttribute(
          'hyperdx.alerts.team.id',
          alertTask.conn.team.toString(),
        );
        span.setAttribute('hyperdx.alerts.connection.id', alertTask.conn.id);
        span.setAttribute('hyperdx.alerts.batch.size', alertTask.alerts.length);

        const { alerts, conn } = alertTask;
        logger.info(
          {
            alertCount: alerts.length,
          },
          'Processing alerts in batch',
        );

        const clickhouseClient = await this.provider.getClickHouseClient(
          conn,
          this.args.sourceTimeoutMs,
        );

        for (const alert of alerts) {
          this.task_queue.add(async () =>
            // withSpan (not a hand-rolled tracer) so exceptions and status are
            // recorded the same way as everywhere else — see agent_docs/observability.md.
            withSpan(
              'processAlert',
              async () => {
                setBusinessContext({ teamId: conn.team.toString() });
                // Set once here, so the alert's own query, the EXPLAIN
                // probes and the notification's sample rows all get tagged.
                await withQueryAttribution(
                  alertQueryAttribution(alert),
                  async () =>
                    processAlert(
                      alertTask.now,
                      alert,
                      clickhouseClient,
                      conn.id,
                      this.provider,
                      teamWebhooksById,
                    ),
                );
              },
              {
                attributes: {
                  'hyperdx.alert.id': alert.alert.id,
                  'hyperdx.team.id': conn.team.toString(),
                  'hyperdx.alert.source': alert.alert.source ?? 'unknown',
                },
              },
            ),
          );
        }
        return true;
      } catch (e) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: getErrorMessage(e),
        });
        span.recordException(e instanceof Error ? e : new Error(String(e)));
        alertBatchFailuresCounter.add(1);
        logger.error(
          {
            connectionId: alertTask.conn.id,
            teamId: alertTask.conn.team.toString(),
            alertCount: alertTask.alerts.length,
            error: serializeError(e),
          },
          'Failed to process alert batch, skipping its alerts for this cycle',
        );
        return false;
      } finally {
        span.end();
      }
    });
  }

  async execute(): Promise<void> {
    if (this.args.taskName !== 'check-alerts') {
      throw new Error(
        `CheckAlertTask can only handle 'check-alerts' tasks, received: ${this.args.taskName}`,
      );
    }

    this.provider = await loadProvider(this.args.provider);
    await this.provider.init();
    logger.debug(
      {
        provider: this.provider.constructor.name,
        args: this.args,
      },
      'finished provider initialization',
    );

    const alertTasks = await this.provider.getAlertTasks();
    const taskCount = alertTasks.length;
    logger.debug(
      {
        taskCount,
        args: this.args,
      },
      `Fetched ${taskCount} alert tasks to process`,
    );

    const teams = new Set(alertTasks.map(t => t.conn.team.toString()));
    const teamToWebhooks = new Map<string, Map<string, IWebhook>>();
    for (const teamId of teams) {
      const teamWebhooksById = await this.provider.getWebhooks(teamId);
      teamToWebhooks.set(teamId, teamWebhooksById);
    }
    logger.debug(
      {
        args: this.args,
        teamCount: teams.size,
        teamWebhookCount: teamToWebhooks.size,
      },
      `Obtained teams and webhooks for all alertTasks`,
    );

    let failedBatchCount = 0;
    for (const task of alertTasks) {
      const teamWebhooksById =
        teamToWebhooks.get(task.conn.team.toString()) ?? new Map();
      this.task_queue.add(async () => {
        const success = await this.processAlertTask(task, teamWebhooksById);
        if (!success) {
          failedBatchCount++;
        }
      });
    }
    logger.debug(
      {
        args: this.args,
      },
      'finished scheduling alert tasks on the task_queue',
    );

    // make sure to await here to drain the work queue and allow
    // functions to execute. if not, execute will terminate without
    // executing all checks
    await this.task_queue.onIdle();
    logger.info(
      {
        args: this.args,
        taskCount,
        failedBatchCount,
      },
      'finished processing all tasks on task_queue',
    );
  }

  name(): string {
    return this.args.taskName;
  }

  async asyncDispose(): Promise<void> {
    if (this.provider) {
      await this.provider.asyncDispose();
    }
  }
}
