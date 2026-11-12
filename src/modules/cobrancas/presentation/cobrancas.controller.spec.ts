import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { CobrancaNaoEncontradaError } from '../application/errors/cobranca-nao-encontrada.error';
import { GetCobrancaByOsUseCase } from '../application/use-cases/get-cobranca-by-os.usecase';
import { Cobranca, StatusCobranca } from '../domain/cobranca.entity';
import { CobrancasController } from './cobrancas.controller';

const ID = '22222222-2222-4222-8222-222222222222';
const OS_ID = '33333333-3333-4333-8333-333333333333';
const ORC_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = 'test-secret';
const DATE = new Date('2026-01-01T00:00:00Z');

describe('CobrancasController (http)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const getByOsUc = { execute: jest.fn() };

  const get = (path: string, role: string | null = 'ATENDENTE') =>
    fetch(`${base}${path}`, {
      headers: role
        ? { authorization: `Bearer ${jwt.sign({ sub: 'u1', role })}` }
        : {},
    });

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
      controllers: [CobrancasController],
      providers: [
        JwtAuthGuard,
        RolesGuard,
        { provide: GetCobrancaByOsUseCase, useValue: getByOsUc },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  it('returns 200 with the output shape', async () => {
    getByOsUc.execute.mockResolvedValue(
      Cobranca.restore({
        id: ID,
        osId: OS_ID,
        orcamentoId: ORC_ID,
        gatewayPaymentId: 'pay-1',
        valor: 150.5,
        status: StatusCobranca.PENDENTE,
        checkoutUrl: 'http://public/gateway/checkout/pay-1',
        correlationId: 'corr-1',
        sagaId: 'saga-1',
        createdAt: DATE,
        updatedAt: DATE,
      }),
    );

    const res = await get(`/cobrancas/by-os/${OS_ID}`, 'CLIENTE');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: ID,
      osId: OS_ID,
      orcamentoId: ORC_ID,
      status: 'PENDENTE',
      valor: 150.5,
      checkoutUrl: 'http://public/gateway/checkout/pay-1',
      motivo: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(getByOsUc.execute).toHaveBeenCalledWith(OS_ID);
  });

  it('returns nulls for a RECUSADA cobranca without orcamento', async () => {
    getByOsUc.execute.mockResolvedValue(
      Cobranca.recusada({
        osId: OS_ID,
        valor: 0,
        motivo: 'orcamento_inexistente',
      }),
    );

    const res = await get(`/cobrancas/by-os/${OS_ID}`, 'MECANICO');
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      orcamentoId: null,
      checkoutUrl: null,
      status: 'RECUSADA',
      motivo: 'orcamento_inexistente',
      valor: 0,
    });
  });

  it('returns 404 when the OS has no cobranca', async () => {
    getByOsUc.execute.mockRejectedValue(
      new CobrancaNaoEncontradaError(`osId=${OS_ID}`),
    );

    const res = await get(`/cobrancas/by-os/${OS_ID}`, 'ADMIN');

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      statusCode: 404,
      error: 'CobrancaNaoEncontradaError',
    });
  });

  it('returns 401 without token', async () => {
    const res = await get(`/cobrancas/by-os/${OS_ID}`, null);
    expect(res.status).toBe(401);
  });

  it('returns 403 for an unknown role', async () => {
    const res = await get(`/cobrancas/by-os/${OS_ID}`, 'VISITANTE');
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid uuid', async () => {
    const res = await get('/cobrancas/by-os/abc');
    expect(res.status).toBe(400);
  });
});
