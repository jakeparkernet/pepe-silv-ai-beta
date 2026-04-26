class Queue {
  constructor() {
    this.items = [];
  }

  // Add an item to the end of the queue
  enqueue(item) {
    this.items.push(item);
  }

  // Remove and return the first item in the queue
  dequeue() {
    if (this.isEmpty()) {
      return undefined; // or throw an Error if you prefer
    }
    return this.items.shift();
  }

  // Peek at the first item without removing it
  peek() {
    return this.isEmpty() ? undefined : this.items[0];
  }

  // Check if the queue is empty
  isEmpty() {
    return this.items.length === 0;
  }

  // Return the current size of the queue
  size() {
    return this.items.length;
  }

  // Clear all items
  clear() {
    this.items = [];
  }
}

export { Queue };