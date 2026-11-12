import { createHmac } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

import { buildPoolConfig } from '../src/prisma/pg-connection';

config();

const OS_ID = '11111111-1111-4111-8111-111111111111';

const b64 = (data: object) =>
  Buffer.from(JSON.stringify(data)).toString('base64url');

function signJwt(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    sub: 'seed-user',
    email: 'seed@local',
    role: 'ATENDENTE',
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac('sha256', secret)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://oficina:oficina@localhost:5433/oficina_billing';
  const secret = process.env.JWT_SECRET ?? 'change-me';

  const prisma = new PrismaClient({
    adapter: new PrismaPg(buildPoolConfig(databaseUrl)),
  });
  try {
    const data = {
      status: 'GERADO' as const,
      valorTotal: '150.00',
      motivoReprovacao: null,
    };
    const orcamento = await prisma.orcamento.upsert({
      where: { osId: OS_ID },
      create: { osId: OS_ID, ...data },
      update: data,
    });
    console.log(`orcamentoId=${orcamento.id}`);
    console.log(`osId=${OS_ID}`);
    console.log(`token=${signJwt(secret)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
