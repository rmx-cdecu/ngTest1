 import { Subject } from 'rxjs/Subject';
import { Observer } from 'rxjs/Observer';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/interval';
import 'rxjs/add/operator/takeWhile';
import 'rxjs/add/operator/distinctUntilChanged';
import { XmppRmx } from './xmpp-rmx-interfaces';
import {XmppRmxMessage, XmppRmxMessageOut} from './xmpp-rmx-message';

/// we inherit from the ordinary Subject
export class XmppWebsocket extends Subject<XmppRmxMessage> {

  public static readonly statusDesc = {
    '-9': 'Error'
    , '-1': 'AuthError'
    , '0': 'Disconnected'
    , '1': 'Connected'
    , '2': 'Session Started'
    , '3': 'Wait Mediator'
    , '4': 'Mediator OK'
    };

  private xmppStatus = 0;
  private xmppClient: any = null;
  private xmppMediator: any = null;
  private reconnectInterval = 10000;  /// pause between connections
  private reconnectAttempts = 5000;  /// number of connection attempts
  private reconnectionObservable: Observable<number> = null;
  private connectionObserver: Observer<number>;
  public connectionStatus: Observable<number>;

  private xmppParam: XmppRmx.IxmppRmxConnectParams = {
    jid: 'carlos-xe7@vpn.restomax.com',
    password: 'carlos-xe7',
    resource: 'testX' + Math.random().toString(36).substring(7),
    transport: 'websocket',
    server: 'vpn.restomax.com',
    wsURL: 'ws://vpn.restomax.com:7070/ws/',
    sasl: ['digest-md5', 'plain'],
    };

  constructor() {
    super();
    console.log('XmppWebsocket Create');

    /// connection status
    this.connectionStatus = new Observable((observer) => {
      this.connectionObserver = observer;
      }).share().distinctUntilChanged();

    /// create stanza.io xmppClient and map event to myself
    this.xmppClient = require('stanza.io').createClient(this.xmppParam);
    this.xmppClient.on('connected',  (e, err) => this.SetXmppStatus(1));
    this.xmppClient.on('auth:failed',  ( ) => {
      console.log('auth:failed');
      this.SetXmppStatus(-1);
      });
    this.xmppClient.on('auth:success',  ( ) => {
      console.log('auth:success');
      this.SetXmppStatus(1);
      });
    this.xmppClient.on('session:started',  ( ) => {
      this.xmppClient.getRoster();
      this.xmppClient.sendPresence();
      this.SetXmppStatus(2);
      this.helo();
      });
    this.xmppClient.on('disconnected',  (e, err) => {
      console.log('disconnected');
      console.log(e);
      console.log(err);
      this.SetXmppStatus(0);
    });
    this.xmppClient.on('raw:incoming', function (xml) {
      // console.log('raw:incoming');
      // console.log(xml);
    });
    this.xmppClient.on('raw:outgoing', function (xml) {
      // console.log('raw:outgoing');
      // console.log(xml);
    });
    this.xmppClient.on('message', (message) => {
       // console.log(message);
      const s: string = message.body;
      // console.log(s);
      const msg = new XmppRmxMessage(s);
      //console.log(msg);
      if (msg.cmd === 'MEDIATOR_OK') {
        this.xmppMediator = message.from;
        this.SetXmppStatus(4);
        return;
        }
      this.next(msg);
      });

    /// we connect
    console.log('XmppWebsocket Created => Connect');
    this.connect();

    /// we follow the connection status and run the reconnect while losing the connection
    this.connectionStatus.subscribe( () => {
      if ((!this.reconnectionObservable) && (this.xmppStatus === 0)) {
        this.reconnect();
      }});
    }

  private SetXmppStatus(Value: number): void {
    if (this.xmppStatus !== Value) {
      console.log('XMPP Status ', this.xmppStatus, '=>', Value, XmppWebsocket.statusDesc[Value]);
      this.xmppStatus = Value;
      this.connectionObserver.next(Value);
    } else {
      console.log('XMPP Stay in Status ', Value);
    }};

  private getMyFullName(): string {
    return this.xmppParam.jid + '/' + this.xmppParam.resource;
    }

  private connect(): void {
    console.log('XmppWebsocket:connect');
    try {
      this.xmppClient.connect();
    } catch (err) {
      /// in case of an error with a loss of connection, we restore it
      console.log('XmppWebsocket:error:' + err);
      this.reconnect();
    }   };

  private reconnect(): void {
    console.log('XmppWebsocket:reconnect subscribe', this.xmppStatus);
    this.reconnectionObservable = Observable.interval(this.reconnectInterval)
      .takeWhile((v, index) => {
        return index < this.reconnectAttempts;
      });
    this.reconnectionObservable.subscribe(
      () => { this.connect(); },
      (error) => { console.log(error); },
      () => {
        /// if the reconnection attempts are failed, then we call complete of our Subject and status
        console.log('XmppWebsocket:completed');
        this.reconnectionObservable = null;
        this.complete();
        this.connectionObserver.complete();
        }
      );
    };

  /**
   * send Helo to mediator
   */
  public helo(): void {
    console.log('XmppWebsocket:helo', this.xmppStatus);
    try {
      this.SetXmppStatus(3);
      const msg = new XmppRmxMessageOut();
      msg.buildMediatorHelo(this.xmppMediator, this.getMyFullName());
      //console.log(msg);
      this.xmppClient.sendMessage(msg);
    } catch (err) {
      /// in case of an error with a loss of connection, we restore it
      console.log('XmppWebsocket:error:' + err);
      this.SetXmppStatus(-9);
    }   };

  /**
   * ask wanted view via xmpp message to mediator
   * @param cmd
   * @param data
   */
  public sendMsg(cmd: string, data: string): void {
    console.log('XmppWebsocket:sendMsg', this.xmppStatus);
    try {
      const msg = new XmppRmxMessageOut();
      msg.buildMediatorCmd(this.xmppMediator, cmd, this.getMyFullName());
      msg.body += data;
      //console.log(msg);
      this.xmppClient.sendMessage(msg);
    } catch (err) {
      /// in case of an error with a loss of connection, we restore it
      console.log('XmppWebsocket:error:' + err);
      this.SetXmppStatus(-9);
    }   };

}
