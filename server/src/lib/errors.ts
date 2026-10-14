/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);

export const validationFailed = (fields: Record<string, string>) =>
  new AppError(400, 'validation_failed', 'Some fields need attention.', fields);

export const unauthorized = (message = 'Please sign in to continue.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found.`);

export const conflict = (message: string, fields?: Record<string, string>) =>
  new AppError(409, 'conflict', message, fields);
