export interface MessageMetrics {
 period:{timezone:string;from:string;to:string};
 sent:number;email:number;whatsapp:number;replies:number;failed:number;pending:number;optouts:number;bounces:number;
 today:{email:number;whatsapp:number;replies:number;failed:number;pending:number};
 series:{date:string;sent:number;replies:number}[];tracking:{opens:null;clicks:null};
}
