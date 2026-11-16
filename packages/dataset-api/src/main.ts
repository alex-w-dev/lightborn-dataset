import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT || process.env.DATASET_API_PORT || 3006);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`dataset api listening on ${port}`);
}

void bootstrap();
