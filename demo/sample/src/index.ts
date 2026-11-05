import { Queue } from "./queue.js";
import { drain } from "./worker.js";

const queue = new Queue<string>(3);
for (const url of ["a", "b", "flaky", "c"]) queue.add(url);

let flakyTries = 0;
await drain(queue, async (url) => {
  if (url === "flaky" && ++flakyTries < 3) throw new Error("try again");
  console.log("done", url);
});
console.log("dead letters:", queue.dead.length);
