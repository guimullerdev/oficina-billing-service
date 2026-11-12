import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { FakeGatewayModule } from './fake-gateway.module';
import { GatewayOAuthController } from './oauth/gateway-oauth.controller';
import { GatewayPaymentsController } from './payments/gateway-payments.controller';

describe('FakeGatewayModule', () => {
  @Global()
  @Module({
    providers: [{ provide: PrismaService, useValue: {} }],
    exports: [PrismaService],
  })
  class FakePrismaModule {}

  const GATEWAY_KEYS = [
    'GATEWAY_CLIENT_ID',
    'GATEWAY_CLIENT_SECRET',
    'GATEWAY_JWT_SECRET',
    'GATEWAY_PUBLIC_BASE_URL',
  ];
  const saved = GATEWAY_KEYS.map((k) => [k, process.env[k]] as const);
  afterAll(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('boots without any GATEWAY_* env (endpoints answer 503 instead)', async () => {
    for (const k of GATEWAY_KEYS) delete process.env[k];

    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakePrismaModule,
        FakeGatewayModule,
      ],
    }).compile();

    const oauth = mod.get(GatewayOAuthController);
    expect(mod.get(GatewayPaymentsController)).toBeDefined();
    await expect(
      oauth.token(undefined, { grant_type: 'client_credentials' }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('fake-gateway isolation', () => {
  // The gateway simulates a third party: it must not reach into billing code.
  const FORBIDDEN_TOP_LEVEL_DIR = 'modules';
  const gatewayRoot = __dirname;
  const srcRoot = resolve(gatewayRoot, '..');

  const listTsFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return listTsFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });

  const importSpecifiers = (source: string): string[] => {
    const pattern =
      /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
    return [...source.matchAll(pattern)].map((m) => m[1]);
  };

  const targetsForbiddenDir = (file: string, specifier: string): boolean => {
    const target = specifier.startsWith('.')
      ? resolve(dirname(file), specifier)
      : resolve(srcRoot, '..', specifier);
    const fromSrc = relative(srcRoot, target);
    return fromSrc.split(sep)[0] === FORBIDDEN_TOP_LEVEL_DIR;
  };

  const files = listTsFiles(gatewayRoot);

  it('scans the gateway sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [relative(srcRoot, f), f]))(
    '%s does not import from the billing domain',
    (_label, file) => {
      const offending = importSpecifiers(readFileSync(file, 'utf8')).filter(
        (s) => targetsForbiddenDir(file, s),
      );
      expect(offending).toEqual([]);
    },
  );

  it('detects a forbidden import (self-check)', () => {
    const fakeFile = join(gatewayRoot, 'payments', 'x.ts');
    const bad = ['..', '..', FORBIDDEN_TOP_LEVEL_DIR, 'auth', 'x'].join('/');
    expect(targetsForbiddenDir(fakeFile, bad)).toBe(true);
    expect(targetsForbiddenDir(fakeFile, '../../prisma/prisma.service')).toBe(
      false,
    );
    expect(
      importSpecifiers(`import { A } from '${bad}';\nimport '${bad}';`),
    ).toEqual([bad, bad]);
  });
});
