import {Injectable, signal} from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class LoggingService {

  public readonly logs = signal<LogEntry[]>([]);

  public log(msg: string, type: 'error'|'info'|'warn' = 'info') {
    const time = new Date().toLocaleTimeString().split(' ')[0];
    this.logs.update(x => {

      x.push({
        type: type,
        msg: msg,
        time: time,
      });

      return x;
    })
  }

  public clear() {
    this.logs.set([]);
  }



}

export interface LogEntry {
  type: 'error'|'info'|'warn';
  time: string;
  msg: string;
}
