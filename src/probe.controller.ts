import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('probe')
@Controller('probe')
export class ProbeController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Readiness probe' })
  check() {
    return {
      message: 'server is ready',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
