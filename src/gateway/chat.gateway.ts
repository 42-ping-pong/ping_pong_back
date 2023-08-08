import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import * as config from 'config';
import { UserService } from 'src/user/user.service';
import { Chat_Room } from 'src/entity/chat_room.entity';
import { ChatRoomService } from 'src/chat_room/chat_room.service';
import { Server } from 'http';

interface MessagePayload {
  roomName: string;
  message: string;
  receiver: string;
}

let createdRooms: string[] = [];

@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: ['http://10.15.1.5:3000'],
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  constructor(
    private userService: UserService,
    private chatRoomService: ChatRoomService,
  ) {}
  private logger = new Logger('Gateway');

  ///모든 이벤트에 우리는 getPayload를 쓴다!

  @WebSocketServer() nsp: Namespace;

  afterInit() {
    // this.logger.log('afterInit');
    this.nsp.adapter.on('delete-room', (room) => {
      const deletedRoom = createdRooms.find(
        (createdRoom) => createdRoom === room,
      );
      if (!deletedRoom) return;

      this.nsp.emit('delete-room', deletedRoom); //socket.emit과 다르다. nsp.emit은 내부에서 내부로 돌리는 것인지?
      createdRooms = createdRooms.filter(
        (createdRoom) => createdRoom !== deletedRoom,
      );
    });

    // this.logger.log('Websock_server_init');
  }

  ////////////////////////////////////// - channel dis/connection - start //////////////////////////////////////
  async handleConnection(@ConnectedSocket() socket: Socket) {
    try {
      console.log('handle_connn!!! in chat');
      const payload = await this.getPayload(socket);
      // console.log("handle_connn!!! in chat1");
      await this.userService.connectChatSocket(payload.username, socket.id);
      // console.log("handle_connn!!! in chat2");
      this.logger.log(
        `chat 채널 connect 호출: ${payload.username}  ${socket.id}`,
      );
    } catch (error) {
      this.logger.error('1. validate_token fail in chat', error);
      // socket.disconnect();
    }
  }

  // 채널(네임스페이스) 탈주
  async handleDisconnect(@ConnectedSocket() socket: Socket) { //////////ㅇㅕ기서도 관관련  데데이이터  모모두  지지워워야야함함.
    this.logger.log('chat 채널 Disconnect 호출');
    try {
      const payload = await this.getPayload(socket);
      await this.userService.disconnectChatSocket(payload.username);
      this.logger.log(`Sock_disconnected ${payload.username} ${socket.id}`);
    } catch (error) {
      console.log('get payload err in chatDisconnect');
      socket.disconnect();
    }
  }
  ////////////////////////////////////// - channel dis/connection - end //////////////////////////////////////

  // 채팅방(룸)에 메세지 보내기
  @SubscribeMessage('ft_message')
  async handleMessage(
    //정상동작으로 만든 뒤, 함수명만 바꿔서 잘 동작하는 지 확인(handleMessage가 예약어인지 확인 필요)
    @ConnectedSocket() socket: Socket,
    @MessageBody() { roomName, message }: MessagePayload,
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
      console.log('======ft_message 이벤트 수신======');
    } catch (error) {
      //나중에 throw 로 교체
      console.log('payloaderr in msg');
      return error;
    }

    //Muted이면 즉시 리턴만해서 처리 -> 아니면 관련 데이터 모두 삭제.

    //block을 제외한 유저에게 보내기
    //메시지 로그 남기기 -> 일단 블록된 유저까지 로그로 다 보여줄 생각임.
    await socket.broadcast.to(roomName).emit('ft_message', {
      username: `${payload.username}`,
      message,
    });

    return { username: payload.username, message };
  }

  // 채팅방(룸) 목록 반환
  @SubscribeMessage('room-list')
  async handleRoomList() {
    this.logger.log('채팅방 목록 반환하기 호출');
    const list = await this.chatRoomService.getRoomList();
    console.log("test in room-list!!!!!!");
    console.log(list);
    /*
    return 양식
    [
      {index:roomName, room_stat:0~3},
      {index:roomName2, room_stat:0~3},
      ,,,,
    ]

    */
    return list;
  }

  // 채팅방(룸) 만들기
  @SubscribeMessage('create-room') //chat_room세팅 및 admin 테이블에 세팅 -> dm은 3, 공개방은 0, 비밀번호방1, 비공개방 2 -> 접근은 초대로만
  async handleCreateRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data:string /////안에 숫자가 있는데, 이거는 어캐하지...
  ) {

    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`채팅방 만들기 호출: ${payload.username} ${socket.id}`);
    } catch (error) {
      console.log('chatroom create 에러');
    }
    const requestUser = await this.userService.getUserByUserName(
      payload.username,
    );
    const userId = requestUser.id;
    const isExist = await this.chatRoomService.isExistRoom(_Data["roomName"]); // 방이 있는지 DB에 유효성 체크
    if (isExist === false) {
      await this.chatRoomService.createChatRoom(userId, _Data["roomName"], _Data["status"] ,_Data["password"], _Data["limitUser"]);
    }
    else{
      return { success: false, payload: `${_Data["roomName"]} 방이 이미 존재합니다.` };
    }
    
    // console.log('creat room name: ', _Data["roomName"]);
    //validateSpaceInRoom()
    if ((await this.chatRoomService.isUserInRoom(userId, _Data["roomName"])) === false) //&& limit_user vs curr_user) // limit 유저보다 작아야만 함. 반드시
      await this.chatRoomService.joinUserToRoom(userId, _Data["roomName"], 2); //이미 유저 네임이 있으면 만들지 않음
    socket.join(_Data["roomName"]);
    console.log(`${payload.username} ${socket.id}`);
    createdRooms.push(_Data["roomName"]);
    this.nsp.emit('create-room', _Data["roomName"]);
    // socket.emit('create-room', _Data["roomName"]);
    return { success: true, payload: _Data["roomName"] };
  }

  // 채팅방(룸) 들어가기
  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() roomName: string,
  ) {
    this.logger.log('채팅방 입장하기 호출: ', socket.id);
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      //나중에 throw 로 교체
      return error;
    }
    const requestUser = await this.userService.getUserByUserName(
      payload.username,
    ); // 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    const userId = requestUser.id;

    if ((await this.chatRoomService.isUserInRoom(userId, roomName)) === false)
      await this.chatRoomService.joinUserToRoom(userId, roomName, 0); //이미 유저 네임이 있으면 만들지 않음
    if ((await this.chatRoomService.isBanedUser(userId, roomName)) == true) //ban되지 않은 경우만 넣기
    {
      return { success: false }; ///banedUser;
    }
    if (await this.chatRoomService.validateSpaceInRoom(roomName)===false) //공간 없으면
    {
      return { success: false }; ///not space
    }
    socket.join(roomName);
    // console.log(payload.username, ' ', socket.id);
    // socket.broadcast.except().to(roomName).emit()
    socket.broadcast.to(roomName).emit('ft_message', {
      username: `${payload.username}`,
      message: `님이 ${roomName}에 참가했습니다.`,
    });
    return { success: true }; //
  }

  // 채팅방(룸) 탈주
  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() roomName: string,
  ) {
    this.logger.log('채팅방 퇴장하기 호출');
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      return error;
    }
    const requestUser = await this.userService.getUserByUserName(
      payload.username,
    );
    const userId = requestUser.id;
    await this.chatRoomService.leaveUserFromRoom(userId, roomName);
    if (await this.chatRoomService.isEmptyRoom(roomName) === true) //방에 인원 없으면 메시지 로그 다 없애기 리턴값 찍어보기, 테스트 필요함
    {
      await this.chatRoomService.deleteChatInformation(roomName);
    }
    socket.leave(roomName);
    socket.broadcast.to(roomName).emit('ft_message', {
      username: `${payload.username}`,
      message: `님이 ${roomName}에서 나갔습니다`,
    });
    return { success: true };
  }

  ////////////////////////////////////// - DM Scope - start //////////////////////////////////////

  @SubscribeMessage('join-dm')
  async handleJoinDm(
    @ConnectedSocket() socket: Socket,
    @MessageBody() userName: string,
  ) {
    console.log('join dm');
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      //나중에 throw 로 교체
      return { success: false };
    }
    let arr = [];
    arr.push(userName);
    arr.push(payload.username);
    arr.sort();
    let roomName = arr.join();
    const requestUser = await this.userService.getUserByUserName(
      payload.username,
    ); // 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    const userId = requestUser.id;
    const isExist = await this.chatRoomService.isExistRoom(roomName); // 방이 있는지 DB에 유효성 체크
    console.log('========');
    console.log(userId, roomName);
    console.log('========');
    if (isExist === false) {
      await this.chatRoomService.createDmRoom(userId, roomName);
    }
    if ((await this.chatRoomService.isUserInRoom(userId, roomName)) === false)
      await this.chatRoomService.joinUserToRoom(userId, roomName, 0); //이미 유저 네임이 있으면 만들지 않음
    socket.join(roomName);
    console.log('========???여기까지???');
    return { success: true, index: roomName };
  }

  @SubscribeMessage('leave-dm') ///DM의 경우에 뒤로가기나, 떠나기 버튼 눌러도 leave-dm을 호출하지는 않는동작이고, "X"를 눌러야만 호출되게끔 한다.
  async handleLeaveDmRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() roomName: string,
  ) {
    // console.log(this.server.
    this.logger.log('채팅방 퇴장하기 호출');
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      //나중에 throw 로 교체
      return error;
    }

    const requestUser = await this.userService.getUserByUserName(
      payload.username,
    ); 
    const userId = requestUser.id;// 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    await this.chatRoomService.leaveUserFromRoom(userId, roomName);
    socket.leave(roomName); //DM과 다르게, 상대방 소켓을 찾아내서 leave 시켜야 한다.
    socket.broadcast.to(roomName).emit('ft_message', {
      username: `${payload.username}`,
      message: `님이 ${roomName}에서 나갔습니다`,
    });
    return { success: true };
  }

  @SubscribeMessage('ft_dm')
  async handleDmMessage(
    //정상동작으로 만든 뒤, 함수명만 바꿔서 잘 동작하는 지 확인(handleMessage가 예약어인지 확인 필요)
    @ConnectedSocket() socket: Socket,
    @MessageBody() { roomName, message, receiver }: MessagePayload,
  ) {
    console.log('======ft_dm 이벤트 수신======');
    // console.log(message);
    // console.log(roomName);
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
      // console.log("======ft_dm 이벤트 수신======");
    } catch (error) {
      //나중에 throw 로 교체
      console.log('payloaderr in msg');
      return error;
    }
    const requestUser = await this.userService.getUserByUserName(
      payload.username,
    ); // 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    const userId = requestUser.id;
    const status = await this.chatRoomService.isNeedDmNoti(userId, roomName);
    // ㄴ이거 반환값이 2보다 작으면 무조건 상대에게 가야함.
    if (status === true) {
      const friend = await this.userService.getChatSocketByUserName(receiver);
      let friends = [];
      friends.push(friend[0].chat_sockid);
      // roomName, user_id, msg, time으로 저장
      console.log('========???여기까지???2222');
      await this.chatRoomService.saveMessage(roomName, userId, message);
      console.log('========???여기까지???3333');

      await socket.broadcast.to(friends).emit('ft_dm', {
        //상대방에게 필요함. status에 따라 내가 쏘는 부분도 다름
        username: `${payload.username}`,
        message,
        status,
      });
    } else {
      await socket.broadcast.to(roomName).emit('ft_dm', {
        //상대방에게 필요함. status에 따라 내가 쏘는 부분도 다름
        username: `${payload.username}`,
        message,
        status,
      });
    }
    return { username: payload.username, message, status };
  }

  @SubscribeMessage('ft_get_dm_log') //Daskim -> roomName -> Back
  async dmLogAPI(
    //정상동작으로 만든 뒤, 함수명만 바꿔서 잘 동작하는 지 확인(handleMessage가 예약어인지 확인 필요)
    @ConnectedSocket() socket: Socket,
    @MessageBody() { roomName }: MessagePayload,
  ) {
      const ret = await this.chatRoomService.getDmMessage(roomName);
      return (ret); ///emit 필요없음. API이므로
  }
  ////////////////////////////////////// - DM Scope - end //////////////////////////////////////

  
  //////
  @SubscribeMessage('ft_get_chat_log') ///채팅방 내 로그 block 빼고 줄 것.
  async chatLogAPI(
    @ConnectedSocket() socket: Socket,
    @MessageBody() { roomName }: MessagePayload,
  ) {

  }

  ////////////////////////////////////////// Payload //////////////////////////////////////////
  async getPayload(socket: Socket) {
    const token = await socket.handshake.auth.token;
    // this.logger.log("======chat token in get payload=======");
    this.logger.log(token);
    // this.logger.log("======chat token in get payload=======");
    const serverConfig = config.get('jwt');
    const secret = serverConfig.secret;
    return (await jwt.verify(token, secret)) as any;
  }
}
