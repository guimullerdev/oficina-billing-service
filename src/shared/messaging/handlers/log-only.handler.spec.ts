import { Logger } from '@nestjs/common';

import { LogOnlyHandler } from './log-only.handler';

describe('LogOnlyHandler', () => {
  it('logs evento, eventId and correlationId and resolves', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const handler = new LogOnlyHandler('os.criada');

    await expect(
      handler.handle({
        messageId: 'm1',
        eventId: 'e1',
        evento: 'os.criada',
        payload: {},
        correlationId: 'c1',
      }),
    ).resolves.toBeUndefined();

    expect(handler.evento).toBe('os.criada');
    expect(spy).toHaveBeenCalledWith(
      'evento=os.criada eventId=e1 correlationId=c1',
    );
    spy.mockRestore();
  });
});
