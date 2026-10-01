import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { hashesMatch } from '../submissions/report-cipher';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY?.trim();
    if (!expected) {
      throw new UnauthorizedException('Admin API key is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = readCredential(request);
    if (!provided || !hashesMatch(provided, expected)) {
      throw new UnauthorizedException('Admin credentials are required');
    }
    return true;
  }
}

function readCredential(request: Request): string | undefined {
  const apiKey = request.header('x-api-key')?.trim();
  if (apiKey) {
    return apiKey;
  }

  const authorization = request.header('authorization')?.trim();
  if (!authorization) {
    return undefined;
  }
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (!token) {
    return undefined;
  }
  if (scheme.toLowerCase() === 'bearer' || scheme.toLowerCase() === 'apikey') {
    return token.trim();
  }
  return undefined;
}
