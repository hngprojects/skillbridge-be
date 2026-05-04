import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

export interface ApiResponse<T> {
  status_code: number;
  message: string;
  data?: T;
  [key: string]: unknown;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const response = context.switchToHttp().getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      map((payload) => {
        const statusCode = response.statusCode;
        const baseResponse = {
          status_code: statusCode,
          message: 'success',
        };

        if (
          payload &&
          typeof payload === 'object' &&
          'paginationMeta' in (payload as object)
        ) {
          const { paginationMeta, payload: data, ...rest } = payload as unknown as {
            paginationMeta: Record<string, unknown>;
            payload: T;
            [key: string]: unknown;
          };
          return {
            ...baseResponse,
            data,
            meta: { ...rest, ...paginationMeta },
          };
        }

        if (
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          'message' in payload
        ) {
          const { message, ...data } = payload as Record<string, unknown>;
          return {
            status_code: statusCode,
            message: String(message),
            ...data,
          };
        }

        return { ...baseResponse, data: payload };
      }),
    );
  }
}
