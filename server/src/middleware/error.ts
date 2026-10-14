import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import type { ApiErrorBody } from '@skillswap/shared';
import type { Logger } from '../config/logger';
import { AppError } from '../lib/errors';

export const apiNotFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'not_found', `No API route matches ${req.method} ${req.path}.`));
};

function normalise(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return new AppError(413, 'file_too_large', 'That file is too large to share.');
    }
    return new AppError(400, 'upload_failed', 'The file could not be uploaded.');
  }
  if (err instanceof mongoose.Error.CastError) {
    return new AppError(400, 'bad_request', 'The request contains an invalid value.');
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return new AppError(400, 'validation_failed', 'Some fields need attention.');
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as { type?: string; code?: number | string; status?: number };
    if (e.type === 'entity.parse.failed') {
      return new AppError(400, 'bad_json', 'The request body is not valid JSON.');
    }
    if (e.type === 'entity.too.large') {
      return new AppError(413, 'payload_too_large', 'The request is too large.');
    }
    if (e.code === 11000) {
      return new AppError(409, 'conflict', 'That already exists.');
    }
  }
  return null;
}

/**
 * The single place errors become responses. Known errors keep their message; anything unexpected
 * is logged with the request id and answered with a generic message, so internals never leak.
 */
export function errorHandler(log: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const known = normalise(err);
    const requestId = typeof req.id === 'string' ? req.id : undefined;

    if (!known) {
      (req.log ?? log).error({ err, requestId }, 'unhandled error');
    } else if (known.status >= 500) {
      (req.log ?? log).error({ err: known, requestId }, 'server error');
    }

    if (res.headersSent) {
      res.end();
      return;
    }

    const body: ApiErrorBody = known
      ? {
          error: {
            code: known.code,
            message: known.message,
            ...(known.fields ? { fields: known.fields } : {}),
            ...(requestId ? { requestId } : {}),
          },
        }
      : {
          error: {
            code: 'internal_error',
            message: 'Something went wrong on our side. Please try again.',
            ...(requestId ? { requestId } : {}),
          },
        };
    res.status(known?.status ?? 500).json(body);
  };
}
