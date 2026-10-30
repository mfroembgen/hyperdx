import express from 'express';
import { z } from 'zod';

import {
  addFavorite,
  getFavorites,
  removeFavorite,
} from '@/controllers/favorite';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { validateRequest } from '@/middleware/validation';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

const resourceTypeSchema = z.enum(['dashboard', 'savedSearch']);

router.get('/', async (req, res, next) => {
  try {
    const { teamId, userId } = getNonNullUserWithTeam(req);

    const favorites = await getFavorites(userId.toString(), teamId.toString());

    return res.json(favorites);
  } catch (e) {
    next(e);
  }
});

router.put(
  '/',
  validateRequest({
    body: z.object({
      resourceType: resourceTypeSchema,
      resourceId: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      const favorite = await addFavorite(
        userId.toString(),
        teamId.toString(),
        req.body.resourceType,
        req.body.resourceId,
      );

      return res.json(favorite);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:resourceType/:resourceId',
  validateRequest({
    params: z.object({
      resourceType: resourceTypeSchema,
      resourceId: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      await removeFavorite(
        userId.toString(),
        teamId.toString(),
        req.params.resourceType,
        req.params.resourceId,
      );

      return res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

export default router;
