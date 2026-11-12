import {
  ArgumentMetadata,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GatewayConfigService } from '../gateway-config.service';
import { GatewayRequest } from '../auth/gateway-auth.guard';
import { CreateGatewayPaymentDto } from './dto/create-gateway-payment.dto';
import { GatewayPaymentsController } from './gateway-payments.controller';
import { GatewayPaymentsService } from './gateway-payments.service';

const ENV: Record<string, string | undefined> = {
  GATEWAY_PUBLIC_BASE_URL: 'https://gw.example.com/prod/',
};
const PAYMENT_ID = '0b9c4a52-6f0e-4d3b-9b8a-0d6f2a1e7c11';
const CREATED_AT = new Date('2026-11-16T12:00:00.000Z');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: PAYMENT_ID,
  idempotencyKey: 'key-1',
  clientId: 'billing-local',
  amountCents: 15000,
  currency: 'BRL',
  description: 'OS 123',
  status: 'pending',
  metadata: { osId: 'os-1' },
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...overrides,
});

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const errorBody = (err: unknown) => (err as HttpException).getResponse();

describe('GatewayPaymentsController', () => {
  let prisma: {
    fakeGatewayPagamento: { findUnique: jest.Mock; create: jest.Mock };
  };
  let controller: GatewayPaymentsController;
  let res: { status: jest.Mock };
  const req = { gatewayClient: { clientId: 'billing-local' } } as never;
  const dto = (overrides: Partial<CreateGatewayPaymentDto> = {}) =>
    Object.assign(new CreateGatewayPaymentDto(), {
      amount_cents: 15000,
      description: 'OS 123',
      metadata: { osId: 'os-1' },
      ...overrides,
    });

  const build = (env = ENV) =>
    new GatewayPaymentsController(
      new GatewayPaymentsService(prisma as never),
      new GatewayConfigService({ get: (k: string) => env[k] } as never),
    );

  beforeEach(() => {
    prisma = {
      fakeGatewayPagamento: { findUnique: jest.fn(), create: jest.fn() },
    };
    res = { status: jest.fn() };
    controller = build();
  });

  describe('POST /gateway/payments', () => {
    it('201 creates a pending payment with checkout_url', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
      prisma.fakeGatewayPagamento.create.mockResolvedValue(row());

      const body = await controller.create('key-1', dto(), req, res as never);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(prisma.fakeGatewayPagamento.create).toHaveBeenCalledWith({
        data: {
          idempotencyKey: 'key-1',
          clientId: 'billing-local',
          amountCents: 15000,
          currency: 'BRL',
          description: 'OS 123',
          metadata: { osId: 'os-1' },
        },
      });
      expect(body).toEqual({
        id: PAYMENT_ID,
        status: 'pending',
        amount_cents: 15000,
        currency: 'BRL',
        description: 'OS 123',
        metadata: { osId: 'os-1' },
        checkout_url: `https://gw.example.com/prod/gateway/checkout/${PAYMENT_ID}`,
        created_at: CREATED_AT.toISOString(),
      });
    });

    it('stores null description/metadata when omitted', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
      prisma.fakeGatewayPagamento.create.mockResolvedValue(
        row({ description: null, metadata: null, currency: 'USD' }),
      );

      const body = await controller.create(
        'key-1',
        dto({ description: undefined, metadata: undefined, currency: 'USD' }),
        req,
        res as never,
      );

      const call = prisma.fakeGatewayPagamento.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.currency).toBe('USD');
      expect(call.data.description).toBeNull();
      expect(call.data.metadata).toBeUndefined();
      expect(body).toMatchObject({ description: null, metadata: null });
    });

    it('200 returns the existing payment for the same key and amount', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(row());

      const body = await controller.create('key-1', dto(), req, res as never);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(prisma.fakeGatewayPagamento.create).not.toHaveBeenCalled();
      expect(body.id).toBe(PAYMENT_ID);
    });

    it.each([
      ['amount', { amount_cents: 99 }],
      ['currency', { currency: 'USD' }],
    ])('409 idempotency_key_conflict on different %s', async (_l, change) => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(row());

      const err = await controller
        .create('key-1', dto(change), req, res as never)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(errorBody(err)).toEqual({ error: 'idempotency_key_conflict' });
    });

    it('409 when the key belongs to another client', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(
        row({ clientId: 'someone-else' }),
      );
      await expect(
        controller.create('key-1', dto(), req, res as never),
      ).rejects.toThrow(ConflictException);
    });

    it.each([undefined, '', '   ', 'k'.repeat(256)])(
      '400 on missing/invalid Idempotency-Key (%p)',
      async (key) => {
        const err = await controller
          .create(key, dto(), req, res as never)
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(prisma.fakeGatewayPagamento.findUnique).not.toHaveBeenCalled();
      },
    );

    it('503 when GATEWAY_PUBLIC_BASE_URL is missing (before writing)', async () => {
      await expect(
        build({}).create('key-1', dto(), req, res as never),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.fakeGatewayPagamento.create).not.toHaveBeenCalled();
    });

    describe('concurrent requests with the same key (P2002)', () => {
      beforeEach(() => {
        prisma.fakeGatewayPagamento.create.mockRejectedValue(uniqueViolation());
      });

      it('re-reads the winner and returns it (200)', async () => {
        prisma.fakeGatewayPagamento.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(row());

        const body = await controller.create('key-1', dto(), req, res as never);

        expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
        expect(body.id).toBe(PAYMENT_ID);
        expect(prisma.fakeGatewayPagamento.findUnique).toHaveBeenCalledTimes(2);
      });

      it('409 when the winner has a different amount', async () => {
        prisma.fakeGatewayPagamento.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(row({ amountCents: 1 }));

        await expect(
          controller.create('key-1', dto(), req, res as never),
        ).rejects.toThrow(ConflictException);
      });

      it('rethrows when the winner cannot be read back', async () => {
        prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
        await expect(
          controller.create('key-1', dto(), req, res as never),
        ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      });
    });

    it('rethrows unexpected database errors', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
      prisma.fakeGatewayPagamento.create.mockRejectedValue(new Error('boom'));
      await expect(
        controller.create('key-1', dto(), req, res as never),
      ).rejects.toThrow('boom');
    });

    it('401 if the guard did not populate the client', async () => {
      await expect(
        controller.create('key-1', dto(), {} as GatewayRequest, res as never),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('GET /gateway/payments/:id', () => {
    it('200 returns the payment', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(row());

      const body = await controller.findOne(PAYMENT_ID, req);

      expect(prisma.fakeGatewayPagamento.findUnique).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID },
      });
      expect(body.checkout_url).toBe(
        `https://gw.example.com/prod/gateway/checkout/${PAYMENT_ID}`,
      );
    });

    it('404 when the payment does not exist', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
      await expect(controller.findOne(PAYMENT_ID, req)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404 when the payment belongs to another client', async () => {
      prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(
        row({ clientId: 'someone-else' }),
      );
      await expect(controller.findOne(PAYMENT_ID, req)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

describe('CreateGatewayPaymentDto validation (global ValidationPipe)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  });
  const meta: ArgumentMetadata = {
    type: 'body',
    metatype: CreateGatewayPaymentDto,
  };

  it('accepts a minimal body and defaults currency to BRL', async () => {
    const out = (await pipe.transform(
      { amount_cents: 100 },
      meta,
    )) as CreateGatewayPaymentDto;
    expect(out).toBeInstanceOf(CreateGatewayPaymentDto);
    expect(out.currency).toBe('BRL');
  });

  it.each([
    [{}],
    [{ amount_cents: 0 }],
    [{ amount_cents: -5 }],
    [{ amount_cents: 1.5 }],
    [{ amount_cents: '100' }],
    [{ amount_cents: 2_147_483_648 }],
    [{ amount_cents: 100, currency: 'brl' }],
    [{ amount_cents: 100, currency: 'REAL' }],
    [{ amount_cents: 100, description: 42 }],
    [{ amount_cents: 100, metadata: 'x' }],
    [{ amount_cents: 100, metadata: [1, 2] }],
    [{ amount_cents: 100, unknown: true }],
  ])('400 on invalid body %j', async (body) => {
    await expect(pipe.transform(body, meta)).rejects.toThrow(
      BadRequestException,
    );
  });
});
