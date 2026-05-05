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
      status_code: 200,
      message: 'I am the NestJs api responding',
    };
  }
}
