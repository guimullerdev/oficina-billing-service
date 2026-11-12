import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { GATEWAY_DEFAULT_CURRENCY } from '../../fake-gateway.constants';

// amount_cents is stored as a PostgreSQL INTEGER (int4).
const MAX_AMOUNT_CENTS = 2_147_483_647;

export class CreateGatewayPaymentDto {
  @ApiProperty({ example: 15000, description: 'Valor em centavos (> 0)' })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  amount_cents!: number;

  @ApiPropertyOptional({ example: 'BRL', default: GATEWAY_DEFAULT_CURRENCY })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be 3 uppercase letters' })
  currency?: string = GATEWAY_DEFAULT_CURRENCY;

  @ApiPropertyOptional({ example: 'Pagamento da OS 123' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { osId: '7b1e...' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
