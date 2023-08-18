import { Injectable } from '@nestjs/common';
import { User } from 'src/entity/user.entity';
import { GameRepository } from './game.repository';

@Injectable()
export class GameService {
  constructor(private gameRepository: GameRepository) { }

  //1p 2p 소켓 id 를 인자로 받음
  async createGame(socket1: string, socket2: string) {
    const user1 = await User.findOne({ where: { game_sockid: socket1 } });
    const user2 = await User.findOne({ where: { game_sockid: socket2 } });
    if (!user1 || !user2) {
      console.log(socket1);
      console.log(socket2);
      console.log('왜 실패?');
      return;
    }
    else {
      console.log(user1.id);
      console.log(user2.id);
    }
    const game = await this.gameRepository.createGame(user1, user2);
    return game;
  }

  async finishGame(winner: User, loser: User) {
    const isBegginer = await this.gameRepository.isBegginer(winner);
    if (isBegginer) {
      await this.gameRepository.createAchievement(winner, 'beginner');
    }
    await this.gameRepository.finishGame(winner, loser);
  }
}
