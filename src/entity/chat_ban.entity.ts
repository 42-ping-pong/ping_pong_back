import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Chat_Ban extends BaseEntity{
    @PrimaryGeneratedColumn()
    id : number;

    @Column()
    index : string;

	@Column()
	ban_user_id : number;
}