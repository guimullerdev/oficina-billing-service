import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../../auth/decorators/roles.decorator';
import { CLIENTE_ROLE, UserRole } from '../../auth/domain/enums/user-role.enum';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import {
  CobrancaOutput,
  toCobrancaOutput,
} from '../application/dto/cobranca-output.mapper';
import { GetCobrancaByOsUseCase } from '../application/use-cases/get-cobranca-by-os.usecase';
import { CobrancaExceptionFilter } from './cobranca-exception.filter';

@ApiTags('cobrancas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente ou inválido' })
@ApiForbiddenResponse({ description: 'Perfil sem permissão' })
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(CobrancaExceptionFilter)
@Controller('cobrancas')
export class CobrancasController {
  constructor(private readonly getCobrancaByOs: GetCobrancaByOsUseCase) {}

  @Get('by-os/:osId')
  @Roles(UserRole.ADMIN, UserRole.ATENDENTE, UserRole.MECANICO, CLIENTE_ROLE)
  @ApiOkResponse({ description: 'Cobrança da OS' })
  @ApiNotFoundResponse({ description: 'Cobrança não encontrada' })
  async findByOs(
    @Param('osId', ParseUUIDPipe) osId: string,
  ): Promise<CobrancaOutput> {
    return toCobrancaOutput(await this.getCobrancaByOs.execute(osId));
  }
}
