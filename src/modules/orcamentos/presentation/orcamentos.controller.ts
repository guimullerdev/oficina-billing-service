import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
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
  OrcamentoOutput,
  toOrcamentoOutput,
} from '../application/dto/orcamento-output.mapper';
import { AprovarOrcamentoUseCase } from '../application/use-cases/aprovar-orcamento.usecase';
import { GetOrcamentoByOsUseCase } from '../application/use-cases/get-orcamento-by-os.usecase';
import { GetOrcamentoUseCase } from '../application/use-cases/get-orcamento.usecase';
import { ReprovarOrcamentoUseCase } from '../application/use-cases/reprovar-orcamento.usecase';
import { ReprovarOrcamentoDto } from './dto/reprovar-orcamento.dto';
import { OrcamentoExceptionFilter } from './orcamento-exception.filter';

const CORRELATION_HEADER = 'x-correlation-id';

@ApiTags('orcamentos')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente ou inválido' })
@ApiForbiddenResponse({ description: 'Perfil sem permissão' })
@ApiNotFoundResponse({ description: 'Orçamento não encontrado' })
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(OrcamentoExceptionFilter)
@Controller('orcamentos')
export class OrcamentosController {
  constructor(
    private readonly getOrcamento: GetOrcamentoUseCase,
    private readonly getOrcamentoByOs: GetOrcamentoByOsUseCase,
    private readonly aprovarOrcamento: AprovarOrcamentoUseCase,
    private readonly reprovarOrcamento: ReprovarOrcamentoUseCase,
  ) {}

  @Get('by-os/:osId')
  @Roles(UserRole.ADMIN, UserRole.ATENDENTE, UserRole.MECANICO, CLIENTE_ROLE)
  @ApiOkResponse({ description: 'Orçamento da OS' })
  async findByOs(
    @Param('osId', ParseUUIDPipe) osId: string,
  ): Promise<OrcamentoOutput> {
    return toOrcamentoOutput(await this.getOrcamentoByOs.execute(osId));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENDENTE, UserRole.MECANICO, CLIENTE_ROLE)
  @ApiOkResponse({ description: 'Orçamento' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrcamentoOutput> {
    return toOrcamentoOutput(await this.getOrcamento.execute(id));
  }

  @Patch(':id/aprovar')
  @Roles(UserRole.ADMIN, UserRole.ATENDENTE, CLIENTE_ROLE)
  @ApiOkResponse({ description: 'Orçamento aprovado' })
  @ApiConflictResponse({ description: 'Transição de status inválida' })
  async aprovar(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(CORRELATION_HEADER) correlationId?: string,
  ): Promise<OrcamentoOutput> {
    const updated = await this.aprovarOrcamento.execute(id, { correlationId });
    return toOrcamentoOutput(updated);
  }

  @Patch(':id/reprovar')
  @Roles(UserRole.ADMIN, UserRole.ATENDENTE, CLIENTE_ROLE)
  @ApiOkResponse({ description: 'Orçamento reprovado' })
  @ApiBadRequestResponse({ description: 'Motivo ausente ou vazio' })
  @ApiConflictResponse({ description: 'Transição de status inválida' })
  async reprovar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReprovarOrcamentoDto,
    @Headers(CORRELATION_HEADER) correlationId?: string,
  ): Promise<OrcamentoOutput> {
    const updated = await this.reprovarOrcamento.execute(id, dto.motivo, {
      correlationId,
    });
    return toOrcamentoOutput(updated);
  }
}
