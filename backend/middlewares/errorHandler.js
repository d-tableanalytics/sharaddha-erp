export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Mongoose Duplicate Key Error
  if (err.code === 11000) {
    statusCode = 400;
    message = `Duplicate field value entered.`;
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your token has expired. Please log in again.';
  }

  console.error(`[Error] ${statusCode} - ${message}`);
  
  res.status(statusCode).json({
    success: false,
    message,
    // A machine-readable code when the thrower supplied one, so a client can
    // branch on WHICH refusal it was rather than matching the message text.
    // Mongo's numeric codes are excluded: 11000 means nothing to a browser and
    // would be the only `code` most responses carried.
    ...(typeof err.code === 'string' ? { code: err.code } : {}),
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
};
