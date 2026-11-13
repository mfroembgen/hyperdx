import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const [project, composeFile, operation, ...args] = process.argv.slice(2);
const composeDir = dirname(resolve(composeFile));
const contents = await Bun.file(composeFile).text();
function interpolate(value) {
  if (typeof value === 'string')
    return value.replace(
      /\$\{([A-Z_0-9]+)(?::-([^}]*))?\}/g,
      (_, key, fallback = '') => process.env[key] || fallback,
    );
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item)]),
    );
  return value;
}
const { services } = interpolate(Bun.YAML.parse(contents));
const network = `${project}-internal`;
const nameFor = service => `${project}-${service}`;

function invoke(command, capture = false, optional = false) {
  // OCB and TypeScript declaration builds exhaust the builder's 2 GB default.
  // Keep all builds consistent: changing these flags recreates its cache VM.
  if (command[0] === 'build') {
    command.splice(1, 0, '--cpus', '4', '--memory', '8G');
  }
  const result = Bun.spawnSync(['container', ...command], {
    env: { ...process.env, NO_COLOR: 'true' },
    stdin: 'inherit',
    stdout: capture ? 'pipe' : 'inherit',
    stderr: optional ? 'ignore' : 'inherit',
  });
  if (result.exitCode && !optional)
    throw new Error(`container ${command[0]} failed (${result.exitCode})`);
  return capture ? result.stdout.toString() : result.exitCode;
}

function inspect(service) {
  const raw = invoke(['inspect', nameFor(service)], true, true);
  return raw ? JSON.parse(raw)[0] : undefined;
}

function selected() {
  const requested = args.filter(arg => services[arg]);
  return requested.length
    ? requested
    : Object.keys(services).filter(key => !services[key].profiles);
}

function imageFor(service) {
  return services[service].image || `${project}-${service}:local`;
}

function build(service) {
  const config = services[service].build;
  if (!config) return;
  const flags = [
    'build',
    '--file',
    resolve(composeDir, config.dockerfile),
    '--tag',
    imageFor(service),
  ];
  if (config.target) flags.push('--target', config.target);
  for (const [key, value] of Object.entries(config.args || {}))
    flags.push('--build-arg', `${key}=${value}`);
  invoke([...flags, resolve(composeDir, config.context)]);
}

function rewriteHosts(value, gateway, service) {
  let result = String(value ?? '').replaceAll('host.docker.internal', gateway);
  for (const name of Object.keys(services)) {
    const address =
      name === service
        ? '127.0.0.1'
        : inspect(name)
            ?.status.networks?.find(item => item.network === network)
            ?.ipv4Address?.split('/')[0];
    if (address)
      result = result
        .replaceAll(`${name}:`, `${address}:`)
        .replaceAll(`//${name}/`, `//${address}/`)
        .replaceAll(`<host>${name}</host>`, `<host>${address}</host>`)
        .replaceAll(
          `<interserver_http_host>${name}</interserver_http_host>`,
          `<interserver_http_host>${address}</interserver_http_host>`,
        );
  }
  return result;
}

function fileMountImage(service, gateway) {
  const files = (services[service].volumes || []).filter(mount => {
    const source = resolve(composeDir, mount.split(':')[0]);
    return existsSync(source) && statSync(source).isFile();
  });
  if (!files.length) return imageFor(service);
  // Apple container shares directories. Copy individual Compose file mounts
  // into a cached layer so the base image's other config files survive.
  const context = resolve('.volumes/apple-config', project, service);
  mkdirSync(context, { recursive: true });
  const instructions = [`FROM ${imageFor(service)}`];
  files.forEach((mount, index) => {
    const [source, target] = mount.split(':');
    writeFileSync(
      resolve(context, String(index)),
      rewriteHosts(
        readFileSync(resolve(composeDir, source), 'utf8'),
        gateway,
        service,
      ),
    );
    chmodSync(
      resolve(context, String(index)),
      statSync(resolve(composeDir, source)).mode & 0o777,
    );
    instructions.push(`COPY ${JSON.stringify([String(index), target])}`);
  });
  writeFileSync(resolve(context, 'Dockerfile'), instructions.join('\n') + '\n');
  const image = `${project}-${service}-config:local`;
  invoke([
    'build',
    '--file',
    resolve(context, 'Dockerfile'),
    '--tag',
    image,
    context,
  ]);
  return image;
}

async function waitForHealth(service) {
  const test = services[service].healthcheck?.test;
  if (!test) return;
  const command = Array.isArray(test)
    ? test[0] === 'CMD'
      ? test.slice(1)
      : ['sh', '-c', test.slice(1).join(' ')]
    : ['sh', '-c', test];
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      Bun.spawnSync(['container', 'exec', nameFor(service), ...command], {
        stdout: 'ignore',
        stderr: 'ignore',
      }).exitCode === 0
    )
      return;
    await Bun.sleep(1000);
  }
  throw new Error(
    `${service} did not become healthy; run scripts/services.sh logs ${service}`,
  );
}

async function up(service, gateway) {
  const config = services[service];
  const dependencies = Array.isArray(config.depends_on)
    ? config.depends_on
    : Object.keys(config.depends_on || {});
  for (const dependency of dependencies) {
    await up(dependency, gateway);
    await waitForHealth(dependency);
  }
  const current = inspect(service);
  if (current?.status.state === 'running') return;
  if (current) invoke(['delete', nameFor(service)]);
  if (
    config.build &&
    (args.includes('--build') ||
      invoke(['image', 'inspect', imageFor(service)], true, true) === '')
  )
    build(service);
  const image = fileMountImage(service, gateway);
  const flags = [
    'run',
    '--detach',
    '--name',
    nameFor(service),
    '--network',
    network,
  ];
  const limits = config.deploy?.resources?.limits;
  flags.push(
    '--cpus',
    String(Math.ceil(Number(limits?.cpus || 2))),
    '--memory',
    limits?.memory || (service === 'ch-server' ? '2G' : '1G'),
  );
  for (const [key, value] of Object.entries({
    ...config.labels,
    'com.docker.compose.project': project,
    'com.docker.compose.service': service,
    'com.docker.compose.project.working_dir': process.cwd(),
  }))
    flags.push('--label', `${key}=${value}`);
  for (const [key, value] of Object.entries(config.environment || {}))
    flags.push('--env', `${key}=${rewriteHosts(value, gateway)}`);
  for (const port of config.ports || [])
    flags.push(
      '--publish',
      String(port).split(':').length === 2 ? `127.0.0.1:${port}` : String(port),
    );
  for (const mount of config.volumes || []) {
    const [source, target, access] = mount.split(':');
    const path = resolve(composeDir, source);
    if (!existsSync(path)) {
      if (!source.startsWith('.volumes/'))
        throw new Error(`Missing bind mount: ${path}`);
      mkdirSync(path, { recursive: true });
    }
    if (statSync(path).isFile()) continue;
    flags.push(
      '--mount',
      `type=bind,source=${path},target=${target}${access === 'ro' ? ',readonly' : ''}`,
    );
  }
  const command =
    typeof config.command === 'string'
      ? config.command.split(/\s+/)
      : config.command || [];
  invoke([...flags, image, ...command]);
}

switch (operation) {
  case 'up': {
    if (!invoke(['network', 'inspect', network], true, true))
      invoke(['network', 'create', network]);
    const gateway = JSON.parse(invoke(['network', 'inspect', network], true))[0]
      .status.ipv4Gateway;
    if (args.includes('--build')) {
      for (const service of Object.keys(services).reverse()) {
        if (inspect(service)) invoke(['delete', '--force', nameFor(service)]);
      }
    }
    for (const service of selected()) await up(service, gateway);
    break;
  }
  case 'down':
    for (const service of Object.keys(services).reverse()) {
      if (inspect(service)) invoke(['delete', '--force', nameFor(service)]);
    }
    if (invoke(['network', 'inspect', network], true, true))
      invoke(['network', 'delete', network]);
    break;
  case 'build':
    for (const service of selected()) build(service);
    break;
  case 'pull':
    for (const service of selected())
      if (!services[service].build)
        invoke(['image', 'pull', imageFor(service)]);
    break;
  case 'exec': {
    const command = args.filter(arg => arg !== '-T');
    const service = command.shift();
    if (!services[service]) throw new Error('exec requires a service name');
    process.exit(invoke(['exec', '-i', nameFor(service), ...command]));
    break;
  }
  case 'logs': {
    const flags = args
      .filter(arg => !services[arg] && arg !== '--no-color')
      .map(arg => (arg === '--tail' ? '-n' : arg));
    for (const service of selected())
      if (inspect(service)) invoke(['logs', ...flags, nameFor(service)]);
    break;
  }
  default:
    throw new Error(`Unsupported service command: ${operation}`);
}
