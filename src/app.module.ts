import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeORMConfig } from './configs/typeorm.config';
import { FriendModule } from './modules/friend.module';
// import { FriendGatewayGateway } from './friend-gateway/friend-gateway.gateway';
// import { FriendGatewayModule } from './friend-gateway/friend-gateway.module';
// import { ChatGateway } from './chat/chat.gateway';
import { ChatModule } from './modules/chat.module';
import { PingPongModule } from './modules/ping_pong.module';
import { ChatMuteModule } from './modules/chat_mute.module';
import { ChatBlockModule } from './modules/chat_block.module';
import { ChatUserModule } from './modules/chat_user.module';
import { GameModule } from './modules/game.module';
import { ChatRoomModule } from './chat_room/chat_room.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { MulterExceptionFilter } from './utils/multerExceptionFilter';

@Module({
  imports: [
    TypeOrmModule.forRoot(typeORMConfig),
    UserModule,
    FriendModule,
    // FriendGatewayModule,
    ChatModule,
    PingPongModule,
    ChatMuteModule,
    ChatBlockModule,
    ChatUserModule,
    GameModule,
    ChatRoomModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public', 'uploads'),
    }),
    ConfigModule.forRoot({ignoreEnvFile: true, isGlobal: true}),
  ],
  controllers: [AppController],
  providers: [AppService, {
    provide: APP_FILTER,
    useClass: MulterExceptionFilter,
  },], //FriendGatewayGateway, ChatGateway
})
export class AppModule {}
