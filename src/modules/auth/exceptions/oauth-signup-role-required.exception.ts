import { BadRequestException } from '@nestjs/common';

export class OAuthSignupRoleRequiredException extends BadRequestException {
  constructor() {
    super('OAuth signup role required');
  }
}
