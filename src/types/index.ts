/**
 * Custom types for the application
 * These were previously Prisma enums but are now defined here
 * since recommendations are no longer stored in the database
 */

export enum Action {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

// Re-export Prisma types that are still used
export { AssetType, Role } from '@prisma/client';
