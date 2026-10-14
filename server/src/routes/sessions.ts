import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  roomCodeSchema,
  sessionCreateSchema,
  sessionReviewSchema,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { AppError, badRequest, notFound } from '../lib/errors';
import { generateStoredFileName } from '../lib/ids';
import { parse, parseId } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import type { createRateLimiters } from '../middleware/security';
import type { SessionDoc } from '../models';
import * as sessions from '../services/sessions';

/** Lower-cased extension when it is on the allow-list, otherwise null. */
export function allowedExtension(fileName: string): string | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return (ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export function sessionRoutes(
  ctx: AppContext,
  limiters: ReturnType<typeof createRateLimiters>,
): Router {
  const router = Router();
  router.use('/sessions', requireAuth(ctx));

  mkdirSync(ctx.env.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: ctx.env.uploadDir,
      filename: (_req, file, cb) => {
        const ext = allowedExtension(file.originalname);
        if (!ext) return cb(new AppError(400, 'file_type', 'That file type cannot be shared.'), '');
        // The name on disk is random; the original name is only ever stored as metadata.
        cb(null, generateStoredFileName(ext));
      },
    }),
    limits: { fileSize: ctx.env.maxUploadBytes, files: 1, fields: 0 },
    fileFilter: (_req, file, cb) => {
      if (allowedExtension(file.originalname)) cb(null, true);
      else {
        cb(
          new AppError(
            400,
            'file_type',
            `That file type cannot be shared. Allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`,
          ),
        );
      }
    },
  });

  router.get('/sessions', async (req, res) => {
    res.json({ items: await sessions.listSessions(currentUser(req)) });
  });

  router.post('/sessions', async (req, res) => {
    const session = await sessions.createSession(
      ctx,
      currentUser(req),
      parse(sessionCreateSchema, req.body),
    );
    res.status(201).json({ session });
  });

  router.get('/sessions/room/:roomCode', async (req, res) => {
    const code = roomCodeSchema.safeParse(req.params.roomCode);
    if (!code.success) throw notFound('Session');
    res.json({ session: await sessions.getSessionDetail(currentUser(req), code.data) });
  });

  router.post('/sessions/:id/cancel', async (req, res) => {
    const session = await sessions.cancelSession(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Session'),
    );
    res.json({ session });
  });

  router.post('/sessions/:id/end', async (req, res) => {
    const session = await sessions.endSession(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Session'),
    );
    res.json({ session });
  });

  router.post('/sessions/:id/review', async (req, res) => {
    const session = await sessions.reviewSession(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Session'),
      parse(sessionReviewSchema, req.body),
    );
    res.status(201).json({ session });
  });

  router.post(
    '/sessions/:id/files',
    limiters.uploads,
    // Membership is checked before a single byte of the upload is accepted.
    async (req, res, next) => {
      res.locals.session = await sessions.assertCanUpload(
        currentUser(req),
        parseId(req.params.id, 'Session'),
      );
      next();
    },
    upload.single('file'),
    async (req, res) => {
      if (!req.file) throw badRequest('Choose a file to share.');
      try {
        const file = await sessions.addFile(
          ctx,
          currentUser(req),
          res.locals.session as SessionDoc,
          {
            originalName: path.basename(req.file.originalname).slice(0, 200),
            storedName: req.file.filename,
            size: req.file.size,
            mimeType: req.file.mimetype,
          },
        );
        res.status(201).json({ file });
      } catch (err) {
        await unlink(req.file.path).catch(() => undefined);
        throw err;
      }
    },
  );

  router.get('/sessions/:id/files/:fileId', async (req, res, next) => {
    const file = await sessions.openFile(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Session'),
      parseId(req.params.fileId, 'File'),
    );
    // Always a download, never rendered: shared files cannot run in this site's origin.
    res.attachment(file.name);
    res.set({
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    file
      .stream()
      .on('error', () => next(notFound('File')))
      .pipe(res);
  });

  router.delete('/sessions/:id/files/:fileId', async (req, res) => {
    await sessions.removeFile(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Session'),
      parseId(req.params.fileId, 'File'),
    );
    res.status(204).end();
  });

  return router;
}
