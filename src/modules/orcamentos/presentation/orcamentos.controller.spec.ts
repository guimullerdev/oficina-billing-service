import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { RolesGuard } from '../../auth/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrcamentoNaoEncontradoError } from '../application/errors/orcamento-nao-encontrado.error';
import { AprovarOrcamentoUseCase } from '../application/use-cases/aprovar-orcamento.usecase';
import { GetOrcamentoByOsUseCase } from '../application/use-cases/get-orcamento-by-os.usecase';
import { GetOrcamentoUseCase } from '../application/use-cases/get-orcamento.usecase';
import { ReprovarOrcamentoUseCase } from '../application/use-cases/reprovar-orcamento.usecase';
import { Dinheiro } from '../domain/dinheiro.vo';
import {
  Orcamento,
  OrcamentoTransicaoInvalidaError,
  StatusOrcamento,
} from '../domain/orcamento.entity';
import { OrcamentosController } from './orcamentos.controller';

const ID = '22222222-2222-4222-8222-222222222222';
const OS_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'test-secret';

function orcamento(status = StatusOrcamento.GERADO, motivo?: string) {
  return Orcamento.restore({
    id: ID,
    osId: OS_ID,
    status,
    valorTotal: Dinheiro.create(150),
    motivoReprovacao: motivo,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
}

describe('OrcamentosController (http)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const getUc = { execute: jest.fn() };
  const getByOsUc = { execute: jest.fn() };
  const aprovarUc = { execute: jest.fn() };
  const reprovarUc = { execute: jest.fn() };

  const token = (role: string) => jwt.sign({ sub: 'u1', role });
  const call = (
    method: string,
    path: string,
    opts: { role?: string | null; body?: object; headers?: object } = {},
  ) => {
    const role = opts.role === undefined ? 'ATENDENTE' : opts.role;
    return fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(role ? { authorization: `Bearer ${token(role)}` } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: SECRET })],
        }),
        JwtModule.register({ secret: SECRET }),
      ],
      controllers: [OrcamentosController],
      providers: [
        JwtAuthGuard,
        RolesGuard,
        { provide: GetOrcamentoUseCase, useValue: getUc },
        { provide: GetOrcamentoByOsUseCase, useValue: getByOsUc },
        { provide: AprovarOrcamentoUseCase, useValue: aprovarUc },
        { provide: ReprovarOrcamentoUseCase, useValue: reprovarUc },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0);
    base = await app.getUrl();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  it('returns 401 without token', async () => {
    const res = await call('GET', `/orcamentos/${ID}`, { role: null });
    expect(res.status).toBe(401);
  });

  it('returns 403 for MECANICO on aprovar', async () => {
    const res = await call('PATCH', `/orcamentos/${ID}/aprovar`, {
      role: 'MECANICO',
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid uuid', async () => {
    const res = await call('GET', '/orcamentos/abc');
    expect(res.status).toBe(400);
  });

  it('GET :id returns 200 with output shape', async () => {
    getUc.execute.mockResolvedValue(orcamento());
    const res = await call('GET', `/orcamentos/${ID}`, { role: 'CLIENTE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ID,
      osId: OS_ID,
      clienteId: null,
      status: 'GERADO',
      valorTotal: 150,
      motivoReprovacao: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('GET :id returns 404 when not found', async () => {
    getUc.execute.mockRejectedValue(new OrcamentoNaoEncontradoError('x'));
    const res = await call('GET', `/orcamentos/${ID}`);
    expect(res.status).toBe(404);
  });

  it('GET by-os returns 200', async () => {
    getByOsUc.execute.mockResolvedValue(orcamento());
    const res = await call('GET', `/orcamentos/by-os/${OS_ID}`, {
      role: 'MECANICO',
    });
    expect(res.status).toBe(200);
    expect(getByOsUc.execute).toHaveBeenCalledWith(OS_ID);
  });

  it('aprovar returns 200 and forwards correlation id', async () => {
    aprovarUc.execute.mockResolvedValue(orcamento(StatusOrcamento.APROVADO));
    const res = await call('PATCH', `/orcamentos/${ID}/aprovar`, {
      headers: { 'x-correlation-id': 'corr-1' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('APROVADO');
    expect(aprovarUc.execute).toHaveBeenCalledWith(ID, {
      correlationId: 'corr-1',
    });
  });

  it('aprovar returns 409 on invalid transition (REPROVADO / twice)', async () => {
    aprovarUc.execute.mockRejectedValue(
      new OrcamentoTransicaoInvalidaError('REPROVADO → APROVADO'),
    );
    const res = await call('PATCH', `/orcamentos/${ID}/aprovar`);
    expect(res.status).toBe(409);
    const again = await call('PATCH', `/orcamentos/${ID}/aprovar`);
    expect(again.status).toBe(409);
  });

  it('aprovar returns 404 when not found', async () => {
    aprovarUc.execute.mockRejectedValue(new OrcamentoNaoEncontradoError('x'));
    const res = await call('PATCH', `/orcamentos/${ID}/aprovar`);
    expect(res.status).toBe(404);
  });

  it('reprovar returns 200 with trimmed motivo', async () => {
    reprovarUc.execute.mockResolvedValue(
      orcamento(StatusOrcamento.REPROVADO, 'caro'),
    );
    const res = await call('PATCH', `/orcamentos/${ID}/reprovar`, {
      body: { motivo: '  caro  ' },
    });
    expect(res.status).toBe(200);
    expect(reprovarUc.execute).toHaveBeenCalledWith(ID, 'caro', {
      correlationId: undefined,
    });
  });

  it.each([{}, { motivo: '' }, { motivo: '   ' }, { motivo: 5 }])(
    'reprovar returns 400 for body %j',
    async (body) => {
      const res = await call('PATCH', `/orcamentos/${ID}/reprovar`, { body });
      expect(res.status).toBe(400);
      expect(reprovarUc.execute).not.toHaveBeenCalled();
    },
  );

  it('reprovar returns 409 on invalid transition', async () => {
    reprovarUc.execute.mockRejectedValue(
      new OrcamentoTransicaoInvalidaError('APROVADO → REPROVADO'),
    );
    const res = await call('PATCH', `/orcamentos/${ID}/reprovar`, {
      body: { motivo: 'x' },
    });
    expect(res.status).toBe(409);
  });
});
