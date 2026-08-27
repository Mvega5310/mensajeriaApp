import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/db.js';

async function main() {
  const email = process.env.OPERATOR_EMAIL;
  const password = process.env.OPERATOR_PASSWORD;

  if (!email || !password) {
    console.log('Define OPERATOR_EMAIL y OPERATOR_PASSWORD en .env para crear la cuenta de operador.');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('La cuenta de operador ya existe:', email);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: 'OPERATOR',
      nombre: process.env.OPERATOR_NOMBRE || 'Operador',
      telefono: process.env.OPERATOR_TELEFONO || '',
      termsAcceptedAt: new Date(),
    },
  });

  console.log('Cuenta de operador creada:', email);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
