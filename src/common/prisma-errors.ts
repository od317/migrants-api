import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function rethrowPrisma(
  error: unknown,
  messages: { notFound: string; conflict: string },
): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      throw new NotFoundException(messages.notFound);
    }
    if (error.code === 'P2002') {
      throw new ConflictException(messages.conflict);
    }
  }

  throw error;
}
