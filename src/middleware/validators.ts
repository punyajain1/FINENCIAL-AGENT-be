import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

/**
 * Validation error handler
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      errors: errors.array(),
    });
    return;
  }
  next();
};

/**
 * Portfolio validation rules
 */
export const addAssetValidation = [
  body('assetName').trim().notEmpty().withMessage('Asset name is required'),
  body('assetType').isIn(['CRYPTO', 'METAL']).withMessage('Asset type must be CRYPTO or METAL'),
  body('symbol').trim().notEmpty().withMessage('Symbol is required'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('buyingPrice').isFloat({ min: 0 }).withMessage('Buying price must be a positive number'),
  handleValidationErrors,
];

export const updateAssetValidation = [
  param('id').isUUID().withMessage('Invalid portfolio ID'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  handleValidationErrors,
];

export const removeAssetValidation = [
  param('id').isUUID().withMessage('Invalid portfolio ID'),
  handleValidationErrors,
];

/**
 * News validation rules
 */
export const getNewsValidation = [
  query('assetType').optional().isIn(['CRYPTO', 'METAL']).withMessage('Invalid asset type'),
  query('sentiment').optional().isIn(['positive', 'negative', 'neutral']).withMessage('Invalid sentiment'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a positive number'),
  handleValidationErrors,
];

/**
 * Chat validation rules
 */
export const chatValidation = [
  body('message').trim().notEmpty().withMessage('Message is required'),
  body('conversationId').optional().trim(),
  handleValidationErrors,
];

export const getChatHistoryValidation = [
  query('conversationId').trim().notEmpty().withMessage('Conversation ID is required'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  handleValidationErrors,
];
