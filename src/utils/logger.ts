import winston from 'winston';
import { config } from '../config/config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      try {
        msg += ` ${JSON.stringify(meta)}`;
      } catch (e) {
        const safeMeta: Record<string, any> = {};
        for (const [key, value] of Object.entries(meta)) {
          if (value instanceof Error) {
            safeMeta[key] = {
              message: value.message,
              stack: value.stack
            };
          } else if (typeof value === 'object' && value !== null) {
            // Safe copy of simple fields or fallback
            safeMeta[key] = '[Circular/Complex Object]';
          } else {
            safeMeta[key] = value;
          }
        }
        msg += ` ${JSON.stringify(safeMeta)}`;
      }
    }
    return msg;
  })
);

// Vercel (and most serverless runtimes) have a read-only filesystem — only /tmp
// is writable, but file logs there are ephemeral and per-invocation anyway.
// Console output is captured natively by Vercel's log pipeline.
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

if (!isServerless) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
});

export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
