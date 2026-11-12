import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  const criarModulo = (databaseUrl?: string): Promise<TestingModule> =>
    Test.createTestingModule({
      providers: [
        PrismaService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(databaseUrl) },
        },
      ],
    }).compile();

  it('should be defined', async () => {
    const module = await criarModulo(
      'postgresql://oficina:oficina@localhost:5432/oficina_billing',
    );

    expect(module.get<PrismaService>(PrismaService)).toBeDefined();
  });

  it('conecta no init e desconecta no destroy', async () => {
    const module = await criarModulo(
      'postgresql://oficina:oficina@localhost:5432/oficina_billing',
    );
    const service = module.get<PrismaService>(PrismaService);
    const connect = jest
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined);
    const disconnect = jest
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  // Antes o serviço aceitava `undefined` e só quebrava na primeira query, com
  // um erro do driver que não dizia o que faltava.
  it('falha no boot quando DATABASE_URL não está configurada', async () => {
    await expect(criarModulo(undefined)).rejects.toThrow(
      'DATABASE_URL não configurada',
    );
  });
});
