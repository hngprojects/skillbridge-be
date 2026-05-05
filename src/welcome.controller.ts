import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('welcome')
@Controller()
export class WelcomeController {
  @Public()
  @Get(['', 'api', 'api/v1'])
  @ApiOperation({ summary: 'API welcome route' })
  welcome() {
    return {
      status_code: 200,
      message: 'I am the NestJs api responding',
    };
  }
}
