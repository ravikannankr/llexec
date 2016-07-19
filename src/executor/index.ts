import { BufferedOutput } from '../buffered-output';
import { ITask, ITaskInfo } from '../task';
import { tokenize } from '../arg-tokenizer';

const childProcess = require('child_process');
const colors = require('colors');

export class Executor {
  public taskList: ITask[] = [];
  private _maxCmdLength: number = 0;
  private _runningProcs: any = [];

  constructor(public lineWrapper?: (taskInfo: ITaskInfo, line: string) => string) {
  }

  private _run(task: ITask, taskIndex: number, resolve: Function, reject: Function): void {
    let [ command, ...args ] = tokenize(task.command);
    let stdoutBuf = null;
    let stderrBuf = null;

    let child = childProcess.spawn('bash', ['-c', task.command]);

    child.on('exit', (code) => {
      // flush the buffers
      stdoutBuf.done();
      stderrBuf.done();
 
      // resolve promise with the exit code
      if (code > 0) {
        // otherwise bubble the error up
        this.killall();
        reject({
          killed: child['killed'],
          command: task.command
        });
      }
      else {
        resolve(true);
      }
    });

    this._runningProcs[taskIndex] = child;

    let taskInfo = {
      task: task,
      commandName: command,
      argList: args,
      argStr: args.join(' '),
      allTasks: this.taskList,
      taskIndex: taskIndex
    };

    stdoutBuf = new BufferedOutput(child.stdout, line => {
      if (!this.lineWrapper) {
        return line;
      }

      return this.lineWrapper(taskInfo, line);
    });

    stderrBuf = new BufferedOutput(child.stderr, line => {
      const lineWrapper = this.lineWrapper || ((ti, l) => l);
      return colors.bgRed(lineWrapper(taskInfo, line));
    });
  }

  private _runTask(task: ITask, index: number): Promise<any> {
    this.taskList.push(task);

    if (task.command.length > this._maxCmdLength) {
      this._maxCmdLength = task.command.length;
    }

    return new Promise((resolve, reject) => {
      this._run(task, index, resolve, reject);
    });
  }

  public killall() {
    this._runningProcs.forEach(proc => proc && proc.kill());
  }

  public run(tasks: ITask[]): Promise<any[]> {
    const promiseList = tasks.map(this._runTask.bind(this));

    return Promise.all(promiseList).catch(function() {
      let results = Array.prototype.slice.call(arguments, 0);
      let failedJobs = results.filter(r => r && !r.killed);

      // rethrow the error so the promise rejects
      return Promise.reject(failedJobs);
    });
  }
}

