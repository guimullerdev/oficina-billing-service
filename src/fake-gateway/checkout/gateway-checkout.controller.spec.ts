import { GatewayCheckoutController } from './gateway-checkout.controller';
import { GatewayCheckoutService } from './gateway-checkout.service';
import { WebhookNotifier } from './webhook-notifier.service';

const ID = '0b9c4a52-6f0e-4d3b-9b8a-0d6f2a1e7c11';
const row = (o: Record<string, unknown> = {}) => ({
  id: ID,
  amountCents: 15000,
  currency: 'BRL',
  description: 'OS <1>',
  status: 'pending',
  metadata: { osId: 'os-1' },
  ...o,
});

function fakeRes() {
  const res = {
    code: 0,
    type: jest.fn(),
    body: '',
    status: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockImplementation((c: number) => {
    res.code = c;
    return res;
  });
  res.type.mockReturnValue(res);
  res.send.mockImplementation((b: string) => {
    res.body = b;
    return res;
  });
  return res;
}

describe('GatewayCheckoutController + service', () => {
  let prisma: {
    fakeGatewayPagamento: { findUnique: jest.Mock; updateMany: jest.Mock };
  };
  let notify: jest.Mock;
  let controller: GatewayCheckoutController;

  beforeEach(() => {
    prisma = {
      fakeGatewayPagamento: { findUnique: jest.fn(), updateMany: jest.fn() },
    };
    notify = jest.fn().mockResolvedValue({ delivered: true });
    const service = new GatewayCheckoutService(
      prisma as never,
      { notify } as unknown as WebhookNotifier,
    );
    controller = new GatewayCheckoutController(service);
  });

  it('GET renders escaped page as html', async () => {
    prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(row());
    const res = fakeRes();
    await controller.page(ID, res as never);
    expect(res.code).toBe(200);
    expect(res.type).toHaveBeenCalledWith('text/html; charset=utf-8');
    expect(res.body).toContain('OS &lt;1&gt;');
    expect(res.body).toContain(`action="${ID}/aprovar"`);
  });

  it('GET 404 when missing', async () => {
    prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
    const res = fakeRes();
    await controller.page(ID, res as never);
    expect(res.code).toBe(404);
    expect(res.body).toContain('Pagamento não encontrado');
  });

  it('pending -> approved calls webhook once', async () => {
    prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(row());
    prisma.fakeGatewayPagamento.updateMany.mockResolvedValue({ count: 1 });
    const res = fakeRes();
    await controller.approve(ID, res as never);
    expect(prisma.fakeGatewayPagamento.updateMany).toHaveBeenCalledWith({
      where: { id: ID, status: 'pending' },
      data: { status: 'approved' },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_id: ID,
        status: 'approved',
        amount_cents: 15000,
        currency: 'BRL',
        metadata: { osId: 'os-1' },
      }),
    );
    expect(res.body).toContain('Pagamento aprovado');
    expect(res.body).not.toContain('Não foi possível');
  });

  it('pending -> declined, notes failed notification', async () => {
    prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(row());
    prisma.fakeGatewayPagamento.updateMany.mockResolvedValue({ count: 1 });
    notify.mockResolvedValue({ delivered: false });
    const res = fakeRes();
    await controller.decline(ID, res as never);
    expect(res.body).toContain('Pagamento recusado');
    expect(res.body).toContain('Não foi possível notificar');
  });

  it('already final: no update, no webhook', async () => {
    prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(
      row({ status: 'approved' }),
    );
    const res = fakeRes();
    await controller.decline(ID, res as never);
    expect(prisma.fakeGatewayPagamento.updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(res.body).toContain('Pagamento aprovado');
  });

  it('not found -> 404', async () => {
    prisma.fakeGatewayPagamento.findUnique.mockResolvedValue(null);
    const res = fakeRes();
    await controller.approve(ID, res as never);
    expect(res.code).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });

  it('race: count 0 re-reads and renders current state without webhook', async () => {
    prisma.fakeGatewayPagamento.findUnique
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'declined' }));
    prisma.fakeGatewayPagamento.updateMany.mockResolvedValue({ count: 0 });
    const res = fakeRes();
    await controller.approve(ID, res as never);
    expect(notify).not.toHaveBeenCalled();
    expect(res.body).toContain('Pagamento recusado');
  });

  it('race: row vanished -> 404', async () => {
    prisma.fakeGatewayPagamento.findUnique
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null);
    prisma.fakeGatewayPagamento.updateMany.mockResolvedValue({ count: 0 });
    const res = fakeRes();
    await controller.approve(ID, res as never);
    expect(res.code).toBe(404);
  });
});
