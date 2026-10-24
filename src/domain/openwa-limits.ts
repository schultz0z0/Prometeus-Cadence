export function openwaLimitPolicy(input:{dailyLimit:number;newConversationLimit:number;platformDailyCap:number;platformNewConversationCap:number}){
 const {dailyLimit,newConversationLimit,platformDailyCap,platformNewConversationCap}=input;const blockers:string[]=[];
 if(Object.values(input).some(value=>!Number.isInteger(value)||value<1||value>100000)||platformNewConversationCap>platformDailyCap)blockers.push('OPENWA_LIMIT_INVALID');
 if(dailyLimit>platformDailyCap||newConversationLimit>platformNewConversationCap||newConversationLimit>dailyLimit)blockers.push('OPENWA_PLATFORM_LIMIT');
 return {allowed:blockers.length===0,blockers};
}
