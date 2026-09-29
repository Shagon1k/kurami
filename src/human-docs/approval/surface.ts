// Post or edit the proposal card and talk in its discussion thread.
import {cardPayload,threadIntroPayload} from "./card.ts";
import {DiscordClient,updatesChannelId} from "./discord.ts";
import type {ProposalRow,ProposalStore} from "./store.ts";
import {componentMessage,textDisplay} from "../../discord/ui.ts";

export type Surface={
  showCard(row:ProposalRow):Promise<void>;
  threadIntro(row:ProposalRow):Promise<void>;
  threadNote(row:ProposalRow,text:string):Promise<void>;
  client:DiscordClient;
};

export function surfaceFor(store:ProposalStore,client=new DiscordClient()):Surface {
  return {
    client,
    async showCard(row){
      if(row.card_channel_id&&row.card_message_id){
        await client.edit(row.card_channel_id,row.card_message_id,cardPayload(row));
        return;
      }
      const channel=updatesChannelId();
      const messageId=await client.post(channel,cardPayload(row));
      store.update(row.proposal_id,{card_channel_id:channel,card_message_id:messageId});
      store.event(row.proposal_id,"card-posted",{});
    },
    async threadIntro(row){
      if(row.thread_id)await client.post(row.thread_id,threadIntroPayload(row));
    },
    async threadNote(row,text){
      if(row.thread_id)await client.post(row.thread_id,componentMessage([textDisplay(text.slice(0,1900))]));
    },
  };
}
