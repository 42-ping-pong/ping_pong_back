import { BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import * as config from 'config';
import { UserService } from 'src/user/user.service';
import { Chat_Room } from 'src/entity/chat_room.entity';
import { ChatRoomService } from 'src/chat_room/chat_room.service';
import { Server } from 'http';
import { FriendService } from 'src/friend/friend.service';
// import { compareSync } from 'bcrypt';

interface MessagePayload {
  roomName: string;
  message: string;
  receiver: string;
}
// let dmAlertMap = new Map<string, Map<string, number>>(); //new 키워드 안에 없음 -> test 필요
/*
//ft-dm 시
dmAlertMap.set("TargetUser",("userName",1)) targetUser의 키값에 내가 알림을 주는 형식

//join-dm 시
dmAlertMap["userName"].delete("targetUser"(상대방));

//getallfriend 호출 시
front에 담아서 같이 주는 형국으로!
getallfriend내부의 객체에 key:val 하나 더 더할 수 있는지 확인 필요.
frine

if (dmAlertMap["userName"].has("friendName") === true)
{
  alert:true 추가
}
else
{
  alert:false 추가
}

{
  nhwang : {
    daskim : 1
    insjang : 1
    ...
  }
  daskim : {
    nhwang : 1
    insjang : 1
  }
}
*/
let createdRooms: string[] = [];

@WebSocketGateway({
  namespace: 'chat',
  cors: {
    origin: ['http://front:3000'],
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  constructor(
    private userService: UserService,
    private chatRoomService: ChatRoomService,
    private friendService : FriendService,
    ) {}
    private logger = new Logger('Gateway');
    
  private dmAlertMap = new Map<string, Map<string, number>>() //new 키워드 안에 없음 -> test 필요

  @WebSocketServer() nsp: Namespace;
  afterInit() {
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
  }

  ////////////////////////////////////// - channel dis/connection - start //////////////////////////////////////
  async handleConnection(@ConnectedSocket() socket: Socket) {
    let payload; 
    // return {checktoken:false};///test
    /*
    test
    */
   try {
     payload = await this.getPayload(socket);
     // console.log('handle_connn!!! in chat');
     await this.userService.connectChatSocket(payload.id, socket.id);
      this.logger.log(
        `chat 채널 connect 호출: ${payload.username}  ${socket.id}`,
      );
    } catch (error) {
      this.logger.error('1. validate_token fail in chat', error);
      return { checktoken:false };
    }
    // console.log("handleConnection friendlist - ", payload);
    const socketList = await this.friendService.getFriendChatSocket(
      payload.id,
    );
    if (!socketList || socketList.length === 0)
      return ;
    if (socketList.length === 0)
    {
      socket.emit('ft_trigger', {
        success:true,
        checktoken:true,
      });
    } 
    else
    {
      socket.broadcast.to(socketList).emit('ft_trigger', {
      success:true,
      checktoken:true,
    });
    }
    socket.emit('ft_tomain', {
      success:true,
      checktoken:true,
    });
  }

  // 채널(네임스페이스) 탈주
  async handleDisconnect(@ConnectedSocket() socket: Socket) {
    //////////ㅇㅕ기서도 관관련  데데이이터  모모두  지지워워야야함함.
    this.logger.log('chat 채널 Disconnect 호출');
    let payload;
    try {
      payload = await this.getPayload(socket);
      // console.log('disconnect - in chat', payload.username); //현재 기존의 것을 기준으로 disconnect 하고 있음.
      const room = await this.chatRoomService.roomCheckDisconnect(payload.id);
      if (room.length !== 0)
      {
        const roomName=room[0].index;
        await this.chatRoomService.leaveUserFromRoom(payload.id, roomName);
        if ((await this.chatRoomService.isEmptyRoom(roomName)) === true) {
            //방에 인원 없으면 메시지 로그 다 없애기 리턴값 찍어보기, 테스트 필요함
            await this.chatRoomService.deleteChatInformation(roomName);
            const list = await this.chatRoomService.getRoomList();
            socket.broadcast.emit('room-list', list);
            socket.leave(roomName);
        }
      }
      // await this.userService.disconnectChatSocket(payload.id);
      //////
      /*
      const query = `select * from "chat_room"`;
      ㄴ> 모든 룸 네임 확인
      
      select * from (select * from "chat_room") as "A" left join chat_user on "chat_user"."index" = "A"."index";
      ㄴ> as B

      select "A"."index" from (select * from (select * from "chat_room") as "A" left join chat_user on "chat_user"."index" = "A"."index") as "B" where "B"."user_id" = 11;
      
      
      
      select "B"."index" from (select "A"."index", "chat_user"."user_id" from (select * from "chat_room") as "A" left join chat_user on "chat_user"."index" = "A"."index") as "B" where "B"."user_id" = ${payload.id};
      ㄴ> 
      */
      /////////여기서 chat 관련 데이터 다 삭제
      this.logger.log(`Sock_disconnected ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('get payload err in chatDisconnect');
      // socket.emit('roomTokenError',{});
      const roomName = await this.chatRoomService.catchErrorRoom(socket.id);
      if (roomName)
        socket.leave(roomName);
      await this.userService.catchErrorFunctionChat(socket.id);/////
      socket.disconnect();
      return { checktoken:false };
    }
    const socketList = await this.friendService.getFriendChatSocket( //이것도 유저네임으로 받아오니까 문제임
      payload.id,
    );
    // console.log("-----socklist----");
    // console.log(socketList);
    // console.log("---------");
    
    // await this.chatRoomService.deleteChatInformation(roomName);
    //[]
    if (socketList.length === 0)
    {
      socket.emit('ft_trigger', {
        success:true,
        checktoken:true,
      });
    } 
    else
    {
      socket.broadcast.to(socketList).emit('ft_trigger', {
        success:true,
        checktoken:true,
      });
    }
  }
  ////////////////////////////////////// - channel dis/connection - end //////////////////////////////////////

  // 채팅방(룸)에 메세지 보내기
  @SubscribeMessage('ft_message')
  async handleMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, //_Data
  ) 
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id} ${payload.id}`);
    } catch (error) {
      return { checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`, success : false };
    }
    
    // const requestUser = await this.userService.getUserByUserId(
    //   payload.id,
    // );
    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );

    // console.log("requestUser :", requestUser.username, "DB Chat_Sockid :",requestUser.chat_sockid, "Real Sock :", socket.id);
    // console.log("roomName :", _Data['roomName']);
    const userId = requestUser.id;
    //Muted이면 즉시 리턴만해서 처리 -> 아니면 관련 데이터 모두 삭제.
    if (await this.chatRoomService.isMuted(_Data['roomName'], userId))
      return {username: `${requestUser.username}`, success : false, faillog : `현재 음소거 상태입니다.`,checktoken:true};
    await this.chatRoomService.saveMessage(_Data['roomName'], userId, _Data['message']);
    const userBlockedMeList =  await this.chatRoomService.findWhoBlockedMe(userId,_Data['roomName']);//block을 제외한 유저에게 보내기
    // console.log("-----------in ft_message find user Who Blocked Me -----------");
    // console.log(userBlockedMeList,_Data['message'],_Data['roomName']);
    // console.log("-----------in ft_message find user Who Blocked Me -----------");
    
    socket.broadcast.except(userBlockedMeList).to(_Data['roomName']).emit('ft_message', {
      username: `${requestUser.username}`,
      message : _Data["message"],
      success : true,
      faillog : ``,
      checktoken:true,
    });

    return { username: requestUser.username, message: _Data['message'], success : true, faillog : `` ,checktoken:true};
  }

  // 채팅방(룸) 목록 반환
  @SubscribeMessage('room-list')
  async handleRoomList() {
    const list = await this.chatRoomService.getRoomList();
    this.logger.log('채팅방 목록 반환하기 호출');
    return list;
  }

  // 채팅방(룸) 만들기
  @SubscribeMessage('create-room') //chat_room세팅 및 admin 테이블에 세팅 -> dm은 3, 공개방은 0, 비밀번호방1, 비공개방 2 -> 접근은 초대로만
  async handleCreateRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, /////안에 숫자가 있는데, 이거는 어캐하지.... roomName, status, password, limitUser
  ) {
      let payload;
      try {
        payload = await this.getPayload(socket);
        this.logger.log(`채팅방 만들기 호출: ${payload.username} ${socket.id}`);
      } catch (error) {
        return { checktoken:false };
      }
      if (_Data['roomName'].length === 0)
        return { success: false, faillog: `채팅방 이름을 지정해야합니다.` ,checktoken:true};
      if (_Data['limitUser'] < 1 || _Data['limitUser'] > 8)
        return { success: false, faillog: `제한인원의 범위는 1~8 입니다.` ,checktoken:true};
      if (_Data['status']==1 && _Data['password']==='')
        return { success: false, faillog: `비밀번호를 설정해야 합니다.` ,checktoken:true};

      const requestUser = await this.userService.getUserByUserId(
        payload.id,
      );
    // // console.log('=======');
    // // console.log(requestUser);
    // // console.log('=======');

      const userId = requestUser.id;
      const isExist = await this.chatRoomService.isExistRoom(_Data['roomName']); // 방이 있는지 DB에 유효성 체크
      if (isExist === false) 
      {
      ////////////////////
        const hashedPassword = await this.chatRoomService.hashPassword(_Data['password']);
      // await this.chatRoomService.createChatRoom(userId, _Data["roomName"], _Data["status"] ,_Data["password"], _Data["limitUser"]);
      await this.chatRoomService.createChatRoom(
        userId,
        _Data['roomName'],
        _Data['status'],
        hashedPassword,
        _Data['limitUser'],
      );
      ////////////////////
      } else 
      {
        // console.log("testsetst");
        return { success: false, faillog: `${_Data["roomName"]} 방이 이미 존재합니다.`,checktoken:true };
      }

    //validateSpaceInRoom()
      if ((await this.chatRoomService.isUserInRoom(userId, _Data['roomName'])) ===false)
        await this.chatRoomService.joinUserToRoom(userId, _Data['roomName'], 2); //이미 유저 네임이 있으면 만들지 않음
      //&& limit_user vs curr_user) // limit 유저보다 작아야만 함. 반드시
      socket.join(_Data['roomName']);
      // console.log(`${payload.username} ${socket.id}`);
      createdRooms.push(_Data['roomName']);
    // // console.log({success: true, payload: _Data["roomName"]});
      await this.userService.settingStatus(payload.id, 3);
      const list = await this.chatRoomService.getRoomList();
      socket.broadcast.emit('room-list', list);
    // this.nsp.emit('create-room', {index: _Data["roomName"], limit_user:_Data["limitUser"],room_stat: _Data["status"]});
    // socket.emit('create-room', _Data["roomName"]);
      return { success: true, faillog: _Data["roomName"], checktoken:true};
  }

  // 채팅방(룸) 들어가기
  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() socket: Socket, //{roomName:name1, password:null}
    @MessageBody() _Data: string, //password 방인 경우에, 유저가 입력한 password까지 줘야하므로, 1. status가 1인 비번방의 경우, join-room의 시점이 다르도록! 다른 컴포넌트필요
  ) {
    this.logger.log('채팅방 입장하기 호출: ', socket.id);
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      //나중에 throw 로 교체
      return {checktoken:false};
    }

    if (await this.chatRoomService.isEmptyRoom(_Data["roomName"]) === true)
      return {success : false, faillog : `존재 하지 않는 방입니다.`,checktoken:true};
    if (await this.chatRoomService.isValidPassword(_Data["roomName"], _Data["password"]) === false) ///create-room 시 비어있는 password와 양식이 같도록!
      return { success: false, faillog : `비밀번호가 일치하지 않습니다.`,checktoken:true}; ///password err _Data["roomName"]

    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    ); // 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    const userId = requestUser.id;
    if ((await this.chatRoomService.isBanedUser(userId, _Data["roomName"])) === true) //ban되지 않은 경우만 넣기
    {
      return { success: false,faillog : `당신은 접근 금지된 유저입니다.`,checktoken:true}; ///banedUser;
    }
    if (await this.chatRoomService.validateSpaceInRoom(_Data["roomName"])===false) //공간 없으면
    {
      return { success: false, faillog : `방이 이미 가득 찼습니다.` ,checktoken:true}; ///not space

    }
    if (
      (await this.chatRoomService.isUserInRoom(userId, _Data['roomName'])) ===
      false
    )
      await this.chatRoomService.joinUserToRoom(userId, _Data['roomName'], 0); //이미 유저 네임이 있으면 만들지 않음

    socket.join(_Data["roomName"]);

    await this.userService.settingStatus(payload.id, 3);
    socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${requestUser.username}`,
      message: `님이 ${_Data['roomName']}에 참가했습니다.`,
      checktoken:true,
    });
    const userList = await this.chatRoomService.getUserListInChatRoom(_Data["roomName"]);
    socket.broadcast.to(_Data["roomName"]).emit("ft_getUserListInRoom", {userList,checktoken:true,});
    return { success: true, faillog : `` ,checktoken:true}; //
  }

  /*
  자기자신 - daskim
  UserList = [
    {username:daskim,'''},
    {username:daskim2,'''}
    {username:daskim3,'''}
  ]
  */

  // 채팅방(룸) 탈주
  @SubscribeMessage('leave-room')
  async handleLeaveRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      return {checktoken:false};
    }
    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );
    const userId = requestUser.id;
    await this.chatRoomService.leaveUserFromRoom(userId, _Data['roomName']);
    if ((await this.chatRoomService.isEmptyRoom(_Data['roomName'])) === true) {
      //방에 인원 없으면 메시지 로그 다 없애기 리턴값 찍어보기, 테스트 필요함
      await this.chatRoomService.deleteChatInformation(_Data['roomName']);
      const list = await this.chatRoomService.getRoomList();
      socket.broadcast.emit('room-list', list);
    }
    socket.leave(_Data['roomName']);
    if (requestUser.status !== 4)
      await this.userService.settingStatus(payload.id,1);
    // const userRight = await this.chatRoomService.getUserRight(userId,roomName);
    // return (await this.chatRoomService.getUserListInChatRoom(_Data["roomName"]));
    const userList = await this.chatRoomService.getUserListInChatRoom(_Data['roomName']);
    socket.broadcast.to(_Data['roomName']).emit("ft_getUserListInRoom", {userList, checktoken:true});
    
    
    this.logger.log('채팅Room 퇴장하기 호출1');
    socket.broadcast.to(_Data['roomName']).emit('ft_message', {
      username: `${requestUser.username}`,
      message: `님이 ${_Data['roomName']}에서 나갔습니다`,
      checktoken:true,
    });
    
    this.logger.log('채팅Room 퇴장하기 호출2');
    return { success: true, checktoken:true };
  }

  ////////////////////////////////////// - DM Scope - start //////////////////////////////////////

  @SubscribeMessage('join-dm')
  async handleJoinDm(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      //나중에 throw 로 교체
      return { success: false, faillog : `Token ERR!` , checktoken:false};
    }
    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );
    // console.log("in join dm target:", _Data['receiver']);
    const targetUser = await this.userService.getUserByUserIntraId(  //상대방의 로컬 스토리지도 내가 변경된 것을 담고 있어야 할 것. -> 확인 필요함
      _Data['receiver'],
    );
    let arr = [];
    arr.push(targetUser.intra_id);
    arr.push(requestUser.intra_id);
    arr.sort();
    let roomName = arr.join();

    // console.log("--------------join dm?");
    const userId = requestUser.id;
    const isExist = await this.chatRoomService.isExistRoom(roomName); // 방이 있는지 DB에 유효성 체크
    if (isExist === false) {
      await this.chatRoomService.createDmRoom(userId, roomName);
      await this.chatRoomService.joinUserToRoom(userId, roomName, 0);
    }
    if ((await this.chatRoomService.isUserInRoom(userId, roomName)) === false)
      await this.chatRoomService.joinUserToRoom(userId, roomName, 0); //이미 유저 네임이 있으면 만들지 않음

    if (this.dmAlertMap.has(`${requestUser.intra_id}`) && this.dmAlertMap.get(`${requestUser.intra_id}`).has(`${targetUser.intra_id}`)===true)
      this.dmAlertMap.get(`${requestUser.intra_id}`).delete(`${targetUser.intra_id}`);
    
    socket.join(roomName);
    await this.userService.settingStatus(payload.id, 2);
    return { success: true, index: roomName, faillog : ``, checktoken:true}; //test!
  }

  @SubscribeMessage('leave-dm')
  async handleLeaveDmRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,
  ) {
    this.logger.log('채팅방 in DM 퇴장하기 호출');
    let payload;
    try {
      payload = await this.getPayload(socket);
    } catch (error) {
      //나중에 throw 로 교체
      return {checktoken:false};
    }

    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );
    const userId = requestUser.id; // 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    await this.chatRoomService.leaveUserFromRoom(userId, _Data["roomName"]);
    socket.leave(_Data["roomName"]); //DM과 다르게, 상대방 소켓을 찾아내서 leave 시켜야 한다.
    await this.userService.settingStatus(payload.id,1);
    // socket.broadcast.to(_Data["roomName"]).emit('ft_dm', {
    //   username: `${payload.username}`,
    //   message: `님이 DM에서 나갔습니다`,
    // });
    return { success: true , checktoken:true};
  }

  @SubscribeMessage('ft_dm')
  async handleDmMessage(
    //정상동작으로 만든 뒤, 함수명만 바꿔서 잘 동작하는 지 확인(handleMessage가 예약어인지 확인 필요)
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, //{ roomName, message, receiver }
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    ); // 유저의 이름으로 유저 id를 가져옴 join, create 등에서 id로 쓰고 싶었기 때문.
    // console.log("in dm reqUser:", requestUser);
    const userId = requestUser.id;
    const status = await this.chatRoomService.isNeedDmNoti(userId, _Data['roomName']);
    // ㄴ이거 반환값이 2보다 작으면 무조건 상대에게 가야함.
    // console.log("in dm _Data[recv]",_Data['receiver']);
    const targerUser = await this.userService.getUserByUserIntraId(_Data['receiver']);
    // console.log("in dm target:",targerUser);

    if (status === true) {
      const friend = await this.userService.getChatSocketByIntraId(_Data['receiver']);
      let friends = [];
      if (friend.length !== 0)
        friends.push(friend[0].chat_sockid);
      // roomName, user_id, msg, time으로 저장
      // console.log("in dm 2");
      await this.chatRoomService.saveMessage(_Data['roomName'], userId, _Data['message']);
      
      //ft-dm 시////////////////
      // this.dm
      if (await this.chatRoomService.isUserInDM(targerUser.id, _Data['roomName']) === false)
      {
        // this.dmAlertMap.get('test');
        // let temp : Map<string,number> = new Map();
        // temp.set(`${payload.username}`,1);
        // this.dmAlertMap.set(receiver,temp);
        if (this.dmAlertMap.has(targerUser.intra_id) === false)
          this.dmAlertMap.set(targerUser.intra_id, new Map<string,number>().set(`${requestUser.intra_id}`,1));
        else
          this.dmAlertMap.get(targerUser.intra_id).set(`${requestUser.intra_id}`,1);
        // console.log("dmMap added!!!", this.dmAlertMap.get(targerUser.intra_id));
      }
      // console.log("==================dm map ========== \n")
      // console.log(this.dmAlertMap.get(targerUser.intra_id));
      // console.log("recver : ",targerUser.intra_id);
      // console.log("==================dm map ========== \n")

      // // console.log("test alert");
      // // console.log("---------receiver",receiver);
      // // // console.log("---------in temp",temp.get(`${payload.username}`)); //temp["insjang"]);
      // // console.log("---------in temp",this.dmAlertMap.get(`${receiver}`)); //temp["insjang"]);
      // // console.log("test alert");
      // // console.log(this.dmAlertMap.has(`${receiver}`));
      // // console.log(this.dmAlertMap.has('test'));
      //ft-dm 시////////////////
      // console.log("in ft_dm :", friends);
      await socket.broadcast.to(friends).emit('ft_dmAlert', {
        username: `${requestUser.username}`,
        receiver : targerUser.intra_id,
        message:_Data['message'],
        status,
        checktoken:true,
      });
    } 
    await socket.broadcast.to(_Data['roomName']).emit('ft_dm', {
      username: `${requestUser.username}`,
      receiver : targerUser.intra_id,
      message:_Data['message'],
      status,
      checktoken:true,
    });
    
    return { username: requestUser.username, receiver: targerUser.intra_id, message:_Data['message'], status , checktoken:true};
  }

  @SubscribeMessage('ft_get_dm_log') //Daskim -> roomName -> Back
  async dmLogAPI(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,
  ) {
    const ret = await this.chatRoomService.getDmMessage(_Data['roomName']);
    return ret; ///emit 필요없음. API이므로
  }
  ////////////////////////////////////// - DM Scope - end //////////////////////////////////////

  @SubscribeMessage('ft_get_chat_log') ///채팅방 내 로그 block 빼고 줄 것.
  async chatLogAPI(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, //
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );
    const userId = requestUser.id;
    return await this.chatRoomService.getChatMessage(userId, _Data['roomName']);
  }

  @SubscribeMessage('ft_isEmptyRoom')
  async checkRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,
  ) {
    return await this.chatRoomService.isEmptyRoom(_Data['roomName']);
  }

  @SubscribeMessage('ft_addAdmin')
  async addAdmin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, //roomName, 상대방 targetUser
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const targetUser = await this.userService.getUserByUserName(
      _Data["targetUser"],
      );
    const user = await this.userService.getUserByUserId(payload.id);
    if (user.username == _Data["targetUser"])
      return {success : false, faillog : `자기 자신에 대해 처리할 수 없습니다.`,checktoken:true};
    const targetUserId = targetUser.id;
    const targetUserRight = await this.chatRoomService.checkRight(_Data["roomName"], targetUserId);
    if (targetUserRight===undefined)
      return { success : false, faillog : `방의 유저가 없습니다.` ,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요.
    if (targetUserRight >= 2) //소유자에 대한 권한 변경 방지 -> 강퇴,Ban,음소거 등에 대해서도 방지 필요.
      return { success : false, faillog : `방의 소유자에 대해서는 처리할 수 없습니다.` ,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요.
    if (targetUserRight >= 1)
      return { success : false, faillog : `이미 관리자인 유저입니다.` ,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요.
    await this.chatRoomService.setAdmin(_Data["roomName"], targetUserId);
    socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${user.username}(Admin)`, //  username: `${payload.username}(Admin)`,  username: `${user.username}(Admin)`,
      checktoken:true,
      message: `${targetUser.username}님이 관리자 임명 되었습니다.`,
    });
    ////////////////////////////////ft_getUserListInRoom를 쏴주기 위함.
    const userId = user.id;
    // const userRight = await this.chatRoomService.getUserRight(userId,_Data["roomName"]);
    
    // return (await this.chatRoomService.getUserListInChatRoom(_Data["roomName"]));
    const userList = await this.chatRoomService.getUserListInChatRoom(_Data["roomName"]);
    // socket.broadcast.to(_Data["roomName"]).emit("ft_getUserListInRoom", {userList, userRight:1}); // ft_getUserListInRoom의 리턴값! return ({userList, userRight:userRight});
    socket.broadcast.to(_Data["roomName"]).emit("ft_getUserListInRoom", {userList,checktoken:true,}); // ft_getUserListInRoom의 리턴값! return ({userList, userRight:userRight});

    //// 상대방이 1이므로 1로 박아서 주고있는데, 이건 문제임.
    ////////////////////////////////ft_getUserListInRoom를 쏴주기 위함.
    //////////test
    socket.emit('ft_message', {
      username: `${user.username}(Admin)`,
      message: `${targetUser.username}님이 관리자 임명 되었습니다.`,
      checktoken:true,
    });
    // socket.emit('ft_getUserListInRoom',{userList, userRight:userRight});
    socket.emit('ft_getUserListInRoom',{userList,checktoken:true});
  }

  @SubscribeMessage('ft_ban')
  async banUser(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, //roomName, 상대방 targetUser
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const user = await this.userService.getUserByUserId(payload.id);
    const targetUser = await this.userService.getUserByUserName(
      _Data["targetUser"],
      );
      if (user.username == _Data["targetUser"])
        return {success : false, faillog : `자기 자신을 금지 할 수 없습니다.`,checktoken:true};
      const targetUserId = targetUser.id;
      
    const targetUserRight = await this.chatRoomService.checkRight(_Data["roomName"], targetUserId);
    if (targetUserRight >= 2) //소유자에 대한 권한 변경 방지 -> 강퇴,Ban,음소거 등에 대해서도 방지 필요.
      return { success : false, faillog:`방의 소유자에 대해서는 처리할 수 없습니다.`,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요. 
    
    const banedRet = await this.chatRoomService.setBan(_Data["roomName"], targetUserId);
    if (banedRet===false)
      return {
        success : false, ///이미 ban인 경우
        faillog : `해당 유저는 이미 금지 상태입니다.`,
        checktoken:true
      };
    socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${user.username}(Admin)`,
      checktoken:true,
      message: `${targetUser.username}님이 현재 채팅방에서 금지되었습니다.`,
    });
    // return {
    //   username: `${user.username}(Admin)`,
    //   message: `${targetUser.username}님이 현재 채팅방에서 금지되었습니다.`,
    // };
    socket.emit('ft_message', {
      username: `${user.username}(Admin)`,
      message: `${targetUser.username}님이 현재 채팅방에서 금지되었습니다.`,
      checktoken:true,
    });
  }

  @SubscribeMessage('ft_block')
  async blockUser(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, //roomName, 상대방 targetUser
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );
    const targetUser = await this.userService.getUserByUserName(
      _Data["targetUser"],
      );
    // console.log("in block : ", payload.username,_Data["targetUser"]);
    if (requestUser.username == _Data["targetUser"])
      return {success : false, faillog : `자기 자신에 대해 처리할 수 없습니다.`,checktoken:true};
    if (await this.chatRoomService.isFriendEachOther(requestUser.id, targetUser.id) === true)
      return {success : false, faillog : `친구끼리는 차단할 수 없습니다.`,checktoken:true};
    const targetUserId = targetUser.id;
    const targetUserRight = await this.chatRoomService.checkRight(_Data["roomName"], targetUserId);
    // if (targetUserRight >= 2) //소유자에 대한 권한 변경 방지 -> 강퇴,Ban,음소거 등에 대해서도 방지 필요.
    //   return { success : false, faillog:`방의 소유자에 대해서는 처리할 수 없습니다.`,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요. 
    const userId = requestUser.id;
    const blockedRet = await this.chatRoomService.setBlock(
      _Data['roomName'],
      targetUserId,
      userId,
    );
    if (blockedRet === false)
      return {
        success : false, ///이미 blocked인 경우
        faillog : `이미 해당 유저를 금지하였습니다.`,
        checktoken:true,
      };
    socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${requestUser.username}`,
      checktoken:true,
      message: `${requestUser.username}님이 ${targetUser.username}님을 차단하였습니다.`,
    });
    // return {
    //   username: `${payload.username}(Admin)`,
    //   message: `${payload.username}님이 ${targetUser.username}님을 차단하였습니다.`,
    // };
    socket.emit('ft_message', {
      username: `${requestUser.username}`,
      checktoken:true,
      message: `${requestUser.username}님이 ${targetUser.username}님을 차단하였습니다.`,
    });
  }

  @SubscribeMessage('ft_getUserListInRoom') //front위해 스스스스로로가  just,admin,Owner인지에 대한 값을 넣어줄지 생각필요
  async getUserListInRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    // const user = await this.userService.getUserByUserId(payload.id);
    // const userId = user.id;
    // const userRight = await this.chatRoomService.getUserRight(userId,roomName);

    // return (await this.chatRoomService.getUserListInChatRoom(roomName));
    const userList = await this.chatRoomService.getUserListInChatRoom(_Data['roomName']);
    // return ({userList, userRight:userRight});
    return ({userList,checktoken:true});
  }
  //*front에서 ft_mute를 setInterval()로 쏴주시면 됩니다. 혹은 다른 이벤트로 해서 줘도 됩니다.
  @SubscribeMessage('ft_mute')
  async muteUser(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, ////roomName, 상대방 targetUser, Mute시간 입력하는 방법으로 갈거면 시간 필요합니다. 디폴트2분 이런거면 안줘도 됌.
  ) {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const user = await this.userService.getUserByUserId(payload.id);

    const targetUser = await this.userService.getUserByUserName(
      _Data["targetUser"],
      );
      const targetUserId = targetUser.id;
    if (user.username == _Data["targetUser"])
      return {success : false, faillog : `자기 자신을 음소거 할 수 없습니다.`,checktoken:true};
    const targetUserRight = await this.chatRoomService.checkRight(_Data["roomName"], targetUserId);
    if (targetUserRight >= 2) //소유자에 대한 권한 변경 방지 -> 강퇴,Ban,음소거 등에 대해서도 방지 필요.
      return { success : false, faillog: `방의 소유자에 대해서는 변경할 수 없습니다.` ,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요. 
    
    if (await this.chatRoomService.setMute(_Data["roomName"], targetUserId)===false) 
      return { success : false, faillog: `대상자는 이미 음소거 중입니다.` ,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요. 
    socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${user.username}(Admin)`, //
      checktoken:true,
      message: `${targetUser.username}님이 현재 채팅방에서 음소거되었습니다.`,
    });

    // return {
    //   username: `${user.username}(Admin)`,
    //   message: `${targetUser.username}님이 현재 채팅방에서 음소거되었습니다.`,
    // };

    const targetSock = await this.userService.getChatSocketByUserName(_Data["targetUser"]);
      let targetSocks = [];
      targetSocks.push(targetSock[0].chat_sockid);
    socket.emit('ft_message', {
      username: `${user.username}(Admin)`,
      checktoken:true,
      message: `${targetUser.username}님이 현재 채팅방에서 음소거되었습니다.`,
    });
    socket.broadcast.to(targetSocks).emit('ft_mute',{
      username: `${user.username}(Admin)`,
      checktoken:true,
      message: `${targetUser.username}님이 현재 채팅방에서 음소거되었습니다.`,
    });

    //roomName에 emit, 자신에 return ->>> 이거 상대방에서 ft_mute_check이 나와야 한다. ... MuteCheck가 아마 프론트에서는 지금 듣고(On은 없을 것으로 예상) 있지 않을 것 같은데, 그걸 들은 클라이언트가ft_mute_check을 호출 할 수 있도록!
    //

  }

  
  @SubscribeMessage('ft_mute_check')  
  async ft_mute_check(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, ////roomName만 주셔도 됩니다.
  )
  {
    // // console.log("test doodooo");
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    if (await this.chatRoomService.isEmptyRoom(_Data["roomName"])===true)
      return {success : 1,checktoken:true};
    const muteUnlockList = await this.chatRoomService.checkMuteUnlock(_Data["roomName"]); //mute 해제된 username들의 리스트 던지기.
    if (muteUnlockList.length === 0)
      return {success : 0,checktoken:true}; ///이건 방이 있을 때는 계속 생성해야 하기 때문에 방이 없으면 false가 아닌 다른 값을 줘야할 것 같은데? -> 0
    /////방이 없으면, 특정한 값을 프론트로 주고, 그 값을 받게되면 프론트는 
    let unlockedUsers = [];
    muteUnlockList.map((i) => {
      if (i.chat_sockid != null)
        unlockedUsers.push(i.username)}
    );
    const user = await this.userService.getUserByUserId(payload.id);

    // console.log("--------userUnlockList---------");
    // console.log(unlockedUsers);
    // console.log("--------userUnlockList---------");

    await socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${user.username}(Admin)`,
      checktoken:true,
      message: `${unlockedUsers}님이 현재 채팅방에서 음소거 해제되었습니다.`, ///리스트로 일단 가가지지고 있있는는데데, 어어떻떻게  해해줄줄지지는  같같이 논논의의하하기.
    })
    // return {
    //   username: `${user.username}(Admin)`,
    //   message: `${unlockedUsers}님이 현재 채팅방에서 음소거 해제되었습니다.`, ///당사자에게만 표시되도록 일부러 다르게 했습니다.
    //   // success : 2
    // }
    socket.emit('ft_message', {
      username: `${user.username}(Admin)`,
      message: `${unlockedUsers}님이 현재 채팅방에서 음소거 해제되었습니다.`,
      checktoken:true,
    });
    return {success : 2,checktoken:true};
  }
  
  @SubscribeMessage('ft_kick')
  async kickRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, ////roomName, targetUser만 주시면 됩니다.
  )
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const targetUser = await this.userService.getUserByUserName(
      _Data["targetUser"],
      );
    const user = await this.userService.getUserByUserId(payload.id);
    
    if (user.username == _Data["targetUser"])
      return {success : false, faillog : `자기 자신을 강퇴 할 수 없습니다.`,checktoken:true};
    const targetUserId = targetUser.id;
      
    const targetUserRight = await this.chatRoomService.checkRight(_Data["roomName"], targetUserId);
    if (targetUserRight >= 2) //소유자에 대한 권한 변경 방지 -> 강퇴,Ban,음소거 등에 대해서도 방지 필요.
      return { success : false, faillog : `방의 소유자에 대해서는 처리할 수 없습니다.` ,checktoken:true}; //right가 2인 유저는 리턴으로 막기. 값은 약속이 필요. 
    ///당사자에게만 쏴주면, 이걸 받아서 처리?
    let targetList = [];
    // targetList.push(target[0].chat_sockid);
    targetList.push(targetUser.chat_sockid);


    
    await socket.broadcast.to(_Data["roomName"]).emit('ft_message', {
      username: `${user.username}(Admin)`,
      message: `${_Data["targetUser"]}님이 현재 채팅방에서 강퇴 되었습니다.`, 
      checktoken:true,
    })
    socket.emit('ft_message', {
      username: `${user.username}(Admin)`,
      message: `${targetUser.username}님이 채팅방에서 강퇴 되었습니다.`,
      checktoken:true,
    });

    await socket.broadcast.to(targetList).emit('ft_kick', {
      success : true,
      checktoken:true,
    });
  }

  /////
  @SubscribeMessage('ft_addfriend')
  async addFriend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, ////roomName, targetUser만 주시면 됩니다. -> receiver
  )
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`,success : false};
    }
    const user = await this.userService.getUserByUserId(payload.id);
    if (user.username == _Data["receiver"])
      return {success : false, faillog : `자기 자신을 친구로 추가할 수 없습니다.`,checktoken:true};
    const recvUser = await this.userService.getUserByUserName(_Data["receiver"]);
    if (await this.chatRoomService.isBlockedEachOther(user.id, recvUser.id, _Data['roomName']) === true)
      return {success : false, faillog : `차단된 유저가 포함되어 있습니다.`,checktoken:true};
    const userId = user.id;
    const targetUserId = recvUser.id;
    if (await this.friendService.isAlreadyFriendReq(userId,targetUserId)===true)
      return {success : false, faillog : `이미 ${recvUser.username}님과 친구요청 시도 중 입니다. 1분 뒤 재시도 하세요.`,checktoken:true}
    if (await this.friendService.isFriend(userId,targetUserId)===true)
      return {success : false, faillog : `이미 ${recvUser.username}님과 친구입니다.`,checktoken:true};
    await this.friendService.addFriend(userId,targetUserId);
    let targetList = [];
    targetList.push(recvUser.chat_sockid);
    // console.log("----------- add friend  test");
    // console.log(targetList);
    await socket.broadcast.to(targetList).emit('ft_addfriend', {
      sender : user.username,
      receiver : recvUser.username,
      success : true,
      checktoken:true,
    });
    return {
      sender : user.username,
      receiver : recvUser.username,
      success : true,
      checktoken:true,
    };
  }

  @SubscribeMessage('ft_acceptfriend') ///받은 사람이 수락한 경우에 대함.
  async accecptFriend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, ////roomName, targetUser만 주시면 됩니다. 이때는 BE입장에서 targetUser가 "sendIdId"에 있을 것임
  )
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`,success : false};
    }
    const recvUser = await this.userService.getUserByUserId(payload.id);
    const sendUser = await this.userService.getUserByUserName(_Data["sender"]);

    const recvUserId = recvUser.id;
    const sendUserId = sendUser.id;
    await this.friendService.accecptFriend(recvUserId, sendUserId);
    let targetList = [];
    targetList.push(sendUser.chat_sockid);
    
    await socket.broadcast.to(targetList).emit('ft_accecptfriend', {
      success : true,
      checktoken:true,
    });
    return {
      success : true,
      checktoken:true,
    };

    // await this.userService.settingStatus(name,2); --> join
    // await this.userService.settingStatus(name,1); --> leave
  }

  @SubscribeMessage('ft_getfriendlist') ///상대에 대해 채팅방으로 초대버튼 누른 경우
  async getFriendList(
    @ConnectedSocket() socket: Socket,
    // @MessageBody() _Data: string, ////roomName, targetUser만 주시면 됩니다. 이때는 BE입장에서 targetUser가 "sendIdId"에 있을 것임
  )
  {
    let payload;

    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false};
    }
    const user = await this.userService.getUserByUserId(payload.id);
    // // console.log("user - ", user);///
    if (user==undefined)
    {
      // console.log("token err in main friendlist");
      return {checktoken:false};
    }
    let ret = await this.friendService.findFriendList(user);
    // // console.log(ret);
    let _return = [];
    ret.map((i) => {
      // if (this.dmAlertMap.has(user.username) === true)
      //   // console.log("has map?", this.dmAlertMap.get(user.username));
      // i["alert"] = this.dmAlertMap.get(`${payload.username}`).has(`${i.intra_id}`);
      i["alert"] = (this.dmAlertMap.has(`${user.intra_id}`) && this.dmAlertMap.get(`${user.intra_id}`).has(`${i.intra_id}`));//저장도 삭삭제제도  모모두  intra_id를 기준으로 할 것.
      // i["alert"] = (this.dmAlertMap.has(`${user.username}`) && this.dmAlertMap.get(`${user.username}`).has(`${i.intra_id}`));


      // // console.log( || this.dmAlertMap.get(`${payload.username}`).has(`${i.intra_id}`));
      _return.push(i);
    });
    /*
    ret.map((i) => {
            if (i.chat_sockid !== null)
                _return.push(i.chat_sockid);//socketid
        });
    */
    socket.emit('ft_getfriendlist', _return);//////_return으로 교교체체할  예예정정 <-await this.friendService.findFriendList(user)
    return (_return);//////_return
  }

  @SubscribeMessage('ft_invitechat') ///상대에 대해 채팅방으로 초대버튼 누른 경우
  async inviteChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, ////roomName, targetUser만 주시면 됩니다. 이때는 BE입장에서 targetUser가 "sendIdId"에 있을 것임
  )
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`msg 전송: ${payload.username} ${socket.id}`);
    } catch (error) {
      // console.log('payloaderr in msg');
      return {checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`,success : false};
    }
    const reqUser = await this.userService.getUserById(payload.id);
    const targetUser = await this.userService.getUserByUserIntraId(
      _Data["targetUser"],
      );

    const room = await this.chatRoomService.checkRoomStatus(_Data["roomName"]);
    if (!room || room.length === 0)
      return {success : false, faillog : `없는 방입니다.`,checktoken:true};
    if (room[0].room_stat ===1) 
    {
      return {success : false, faillog : `비밀번호 방은 초대할 수 없습니다.`,checktoken:true};
    }
    if (targetUser.status != 1)
    {
      let log = ["오프라인","가능","다른 유저와 DM 중", "채팅 중", "게임 중"];
      return {success : false, faillog : `해당 유저가 ${log[targetUser.status]} 입니다.`,checktoken:true};
    }
    let targetList = [];
    // console.log('-------inviteChat-------');
    // console.log(_Data);
    // console.log(reqUser);
    // console.log('-------inviteChat-------');

    // targetList.push(target[0].chat_sockid);
    targetList.push(targetUser.chat_sockid);
    await socket.broadcast.to(targetList).emit('ft_invitechat', { //// 초대받은 대상소켓에게 emit합니다.
      index : _Data["roomName"],
      success : true,
      sender : `${reqUser.username}`, //sender : `${payload.username}`, vs sender : `${reqUser.username}`, 
      checktoken : true,
    }); ////감지해서 받으면 모달 띄우기 -> 그 모달에서 "수락" 누르면 join-room 으로 해주시면 됩니다. password는 기존처럼 빈문자 주시면 되구요~
    return {success : true, checktoken:true};
  }

  @SubscribeMessage('ft_changeroompassword') ///상대에 대해 채팅방으로 초대버튼 누른 경우
  async changeRoomPassword(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string, 
  )
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`채팅방 만들기 호출: ${payload.username} ${socket.id}`);
    } catch (error) {
      return {checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`,success : false};
    }

    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );
    if (_Data["password"] =='')
    {
      return { success: false, faillog: `비밀 번호를 입력해주십시오.`,checktoken:true };
    }
    const userId = requestUser.id;
    const isExist = await this.chatRoomService.isExistRoom(_Data["roomName"]); // 방이 있는지 DB에 유효성 체크
    if (isExist === true) {
      ////////////////////
      const hashedPassword = await this.chatRoomService.hashPassword(_Data["password"]);
      // await this.chatRoomService.createChatRoom(userId, _Data["roomName"], _Data["status"] ,_Data["password"], _Data["limitUser"]);
      await this.chatRoomService.updateRoomPassword(userId, _Data["roomName"],hashedPassword);
      ////////////////////
    } else {
      return { success: false, faillog: `${_Data["roomName"]} 방이 없습니다.` ,checktoken:true};
    }
    const list = await this.chatRoomService.getRoomList();
    socket.broadcast.emit("room-list",list);
    return { success: true, faillog: `비밀번호가 변경되었습니다.`,checktoken:true};
  }

  @SubscribeMessage('ft_deleteroompassword') ///상대에 대해 채팅방으로 초대버튼 누른 경우
  async deleteRoomPassword(
    @ConnectedSocket() socket: Socket,
    @MessageBody() _Data: string,  ///roomName만 있으면 됍니다.
  )
  {
    let payload;
    try {
      payload = await this.getPayload(socket);
      this.logger.log(`채팅방 만들기 호출: ${payload.username} ${socket.id}`);
    } catch (error) {
      return {checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`,success : false};
    }

    const requestUser = await this.userService.getUserByUserId(
      payload.id,
    );

    const userId = requestUser.id;
    const isExist = await this.chatRoomService.isExistRoom(_Data["roomName"]); // 방이 있는지 DB에 유효성 체크
    if (isExist === true) {
      ////////////////////
      // await this.chatRoomService.createChatRoom(userId, _Data["roomName"], _Data["status"] ,_Data["password"], _Data["limitUser"]);
      await this.chatRoomService.deleteRoomPassword(userId, _Data["roomName"]);
      ////////////////////
    } else {
      return { success: false, faillog: `${_Data["roomName"]} 방이 없습니다.` ,checktoken:true};
    }
    const list = await this.chatRoomService.getRoomList();
    socket.broadcast.emit("room-list",list);
    return { success: true, faillog: `비밀번호가 삭제되었습니다.`,checktoken:true};
  }

  @SubscribeMessage('ft_changenickname') ///상대에 대해 채팅방으로 초대버튼 누른 경우
  async changeNickname(
    @ConnectedSocket() socket: Socket,
    // @MessageBody() _Data: string,  ///roomName만 있으면 됍니다.
  )
  {
    let payload; 
    try {
      payload = await this.getPayload(socket);
      // console.log('ft_changenickname!!! in chat');
      // await this.userService.connectChatSocket(payload.id, socket.id);
      this.logger.log(
        `chat 채널 connect 호출: ${payload.username}  ${socket.id}`,
      );
    } catch (error) {
      return {checktoken:false,faillog:`Token 만료입니다. 다시 로그인 해주세요.`,success : false};
      // socket.disconnect();
    }
    const socketList = await this.friendService.getFriendChatSocket(
      payload.id,
    );
    await socket.broadcast.to(socketList).emit('ft_trigger', {
      success:true,
      checktoken:true,
    });
  }
  /*
                    CHAT  TEST CASE!
  비공개방,비밀번호 방 테스트 : 여러 유저가 방을 여러개 만든다. -> 비공개방에 대해서는 보이지 말아야 하며, 비밀번호방은 자물쇠가 보여야 함
  초대테스트 : 초대해놓고 방 나간다음 초대의 대상이 되는 유저가 초대를 수락하는 경우!
  ㄴ> 인원수가 꽉 차있는 경우

  비밀번호 테스트 : 비밀번호가 틀린경우
  비밀번호 테스트 : 비밀번호가 맞지만 인원이 꽉차있는 경우

  일반 방 테스트 : 인원이 꽉 차있는 경우.

  ban 테스트 : 밴한 유저가 나간다음 다시 들어오려는 경우
  kick 테스트 : 강퇴만 됨. 다시 들어오는 것 가능.
  ban하고 kick : 못들어와야함

  block 테스트 : 여러 유저가 같은 방에 있을때, block한 유저의 메시지는 보이지 말고, 나머지 유저들에게는 잘 보여야함.
  block && mute 테스트 : 한명은 블락하고 한명은 뮤트. -> 제3자입장에선 뮤트만 안 보여야 함. 당사자 간에는 
  block && mute해제 테스트 : 위의 케이스에서 시간이 지난 뒤 뮤트 풀린 유저에 대해서도 잘 보여야한다.


                    CHAT  DETAIL TODO
  닉네임 변경하는 경우, dm인 chat_room, chat_user, chat_room_msg에서 본인이 포함된 모든 index 수정 
  dm의 경우에 나가기 하면 -1

  */


  // @SubscribeMessage('roomTokenError')
  // async handleLeaveRoomTokenError(
  //   @ConnectedSocket() socket: Socket,
  // ) {
  //   // console.log("=========== roomTokenError");
  //   const userArr = await this.chatRoomService.checkUserTokenError(socket.id);
  //   if (userArr.length === 0)
  //     return ;
  //   const user = userArr[0]
  //   const userId = user.id;
  //   const room = await this.chatRoomService.checkRoomTokenError(userId);
  //   if (room.length === 0)
  //     return ;
  //   const roomName = room[0];
  //   // console.log("=========== roomTokenError",roomName);
  //   await this.chatRoomService.leaveUserFromRoom(userId, roomName);
  //   if ((await this.chatRoomService.isEmptyRoom(roomName)) === true) {
  //     await this.chatRoomService.deleteChatInformation(roomName);
  //     // const list = await this.chatRoomService.getRoomList();
  //     // socket.broadcast.emit('room-list', list);
  //   }
  //   socket.leave(roomName);
  //   // await this.userService.settingStatus(userId,0);
  //   return ;
  // }

  ////////////////////////////////////////// Payload //////////////////////////////////////////
  async getPayload(socket: Socket) {
    const token = await socket.handshake.auth.token;
    this.logger.log(token);
    // const serverConfig = config.get('jwt');
    // const secret = serverConfig.secret;
    const secret = process.env.JWT_SECRET;
    return (await jwt.verify(token, secret)) as any;
  }

  ////////////////////////////////////////test for kick////////////////////////
  ////////////////////////////////////////test for kick////////////////////////
}
