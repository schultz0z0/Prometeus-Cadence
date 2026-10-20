import type {Principal} from '../../domain/workspace.ts';import {AppError} from '../errors.ts';
export const permissions=['data.write','context.draft','context.approve','workspace.settings','members.manage'] as const;
export type Permission=typeof permissions[number];
export function capabilities(role:Principal['role']):Permission[]{return role==='operator'?['data.write','context.draft']:[...permissions];}
export function requirePermission(p:Principal,permission:Permission){if(!capabilities(p.role).includes(permission))throw new AppError(403,'Seu papel não permite esta alteração.');}
