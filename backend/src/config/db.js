import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenantExtension.js';

// ÚNICO PrismaClient de la app, ya extendido con el aislamiento multi-conjunto
// (KAN-8, design.md §2.3). Todo el backend importa `prisma` desde aquí, de modo
// que no existe forma de obtener un cliente SIN la extensión de tenant.
//
// Invariante (checklist de tasks.md): un solo PrismaClient extendido. No se
// exporta ni se crea en ninguna otra parte un cliente base sin extender.
export const prisma = new PrismaClient().$extends(tenantExtension());
