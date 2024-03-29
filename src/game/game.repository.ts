import { Inject, Injectable } from '@nestjs/common';
import { Game } from 'src/entity/game.entity';
import { User } from 'src/entity/user.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class GameRepository extends Repository<Game> {
  constructor(private dataSource: DataSource) {
    super(Game, dataSource.createEntityManager());
  }

  async createGame(user1: User, user2: User) {
    await this.query(`insert into "game" ("winner", "loser", "finished") values (${user1.id}, ${user2.id}, false);`);
  }

  async getUserByGameSockId(game_sockid: string): Promise<User> {
    const user = User.findOne({ where: { game_sockid } });
    // const [user] = await this.query(
    //   `select * from "user" where game_sockid = '${game_sockid}'`,
    // );
    return user;
  }

  async finishGame(winner: User, loser: User) {
    if (!winner || !loser) {
      console.log('user 정보 없음');
      // User가 NULL 또는 undefined인 경우를 여기서 확인하는 이유
      // finished가 false인 게임 삭제를 위해
      await this.delete({ finished: false });
      return;
    }
    const result = await this.query(`
    select game_id from game
    where (winner = ${winner.id} or loser = ${winner.id}) and finished = false`);
    const game_id = result[0].game_id;
    const playedTime = new Date().toISOString();
    const query = `
      update game
      set winner = ${winner.id}, loser = ${loser.id}, time = '${playedTime}', finished = true
      where game_id = ${game_id}`;
    await this.query(query);
  }

  async isBegginer(user: User): Promise<boolean> {
    if (!user) {
      return ;
    }
    const isBegginer = await this.query(`
      select * from achievement
      where user_id = ${user.id} and achievement = 'beginner'`);
    if (isBegginer.length === 0) {
      return true;
    }
    return false;
  }

  async createAchievement(user: User, achievement: string) {
    const query = `
      insert into achievement (user_id, achievement)
      values (${user.id}, '${achievement}')`;
    return await this.query(query);
  }
}

