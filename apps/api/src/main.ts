import 'reflect-metadata';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

export function configureApp(app: INestApplication) {
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins.length ? config.corsOrigins : false, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'n/:slug', method: RequestMethod.GET }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(config.port);
  console.log(`✔ MAVY NEWS API running at http://localhost:${config.port}/api/v1/health`);
}

if (require.main === module) bootstrap();
