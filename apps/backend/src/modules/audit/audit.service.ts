import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogDto } from '@butterfly/shared-types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(
    userId: string | null,
    action: string,
    resourceType?: string,
    resourceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          resourceType: resourceType ?? null,
          resourceId: resourceId ?? null,
          metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log: ${action}`, err);
    }
  }

  async findAll(
    page = 1,
    limit = 50,
    filters?: { action?: string; startTime?: string; endTime?: string },
  ): Promise<{ items: AuditLogDto[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};
    if (filters?.action) where.action = filters.action;
    if (filters?.startTime || filters?.endTime) {
      where.createdAt = {
        ...(filters.startTime ? { gte: new Date(filters.startTime) } : {}),
        ...(filters.endTime ? { lte: new Date(filters.endTime) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map((log) => ({
        id: log.id.toString(),
        userId: log.userId,
        userEmail: log.user?.email ?? null,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        metadata: log.metadata as Record<string, unknown> | null,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }
}
