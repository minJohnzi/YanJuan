import { Router } from 'express';
import type { SystemCapabilitiesResponse } from '../../domain/ai.ts';

/**
 * Exposes runtime capabilities (storage engine, Google AI Studio GEMINI_API_KEY detection,
 * PIN protection state, and registered exam subjects) without revealing sensitive secrets.
 */
export function createSystemRouter(): Router {
  const router = Router();

  router.get('/capabilities', (_req, res) => {
    const hasServerGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    const requiresServerPin = Boolean(process.env.SERVER_AI_ACCESS_PIN?.trim());
    const isAiStudioOrCloud = Boolean(
      process.env.K_SERVICE || process.env.AI_STUDIO_ENV || process.env.GOOGLE_CLOUD_PROJECT
    );

    const payload: SystemCapabilitiesResponse = {
      deploymentTarget: isAiStudioOrCloud ? 'google-aistudio' : 'local-node',
      storageEngine: 'node:sqlite',
      localFirstMode: true,
      hasServerGeminiKey,
      requiresServerPin,
      serverDefaultModel: hasServerGeminiKey
        ? process.env.GEMINI_DEFAULT_MODEL?.trim() || 'gemini-2.5-flash'
        : null,
      supportedSubjects: ['english-i', 'politics'],
    };

    res.json(payload);
  });

  return router;
}
