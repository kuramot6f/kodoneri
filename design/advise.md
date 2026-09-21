Implement the memory system as a small, explicit long-term state manager rather than as a compressed conversation history.

The intended architecture is:

`conversation turn completes -> fork a separate memory-maintenance branch -> inspect existing memory -> optionally modify memory -> terminate branch`

The memory-maintenance branch should start from the same conversation prefix as the normal dialogue so that prefix/KV caching can be reused where the API supports it. Memory maintenance must not modify or extend the visible conversation.

## Memory model

Memory is organized by topic. Each topic represents a persistent semantic area such as a project, preference, user background, ongoing plan, or recurring constraint.

The model can inspect memory using:

* `list`
* `grep`
* `read`

and modify it using:

* `patch(ref, old, new)`
* `new(id, title)`
* `delete(ref)`

Do not treat every new piece of information as a new memory entry. Topic memories should evolve over time.

## Core write policy

The default action after a conversation turn should be **no memory update**.

Only store information that is reasonably likely to be useful in a future conversation. Examples include persistent preferences, important facts, ongoing projects, decisions, constraints, plans, and meaningful changes to previous information.

Do not normally store:

* greetings or casual conversation
* one-off questions
* information that only matters to the current answer
* generic assistant explanations
* obvious information already present in memory
* speculative interpretations of the user

Before modifying memory, inspect relevant existing topics. Prefer updating an existing topic instead of creating a new one.

A new topic should be created only when the information does not naturally belong to an existing topic. `new` therefore means "create a new semantic home", not "store a new fact".

## Updating existing memory

`patch` should be the normal write operation.

When new information extends an existing topic, integrate it into that topic rather than appending disconnected facts indefinitely.

When the user corrects previous information, update the incorrect information instead of keeping contradictory current-state statements.

However, distinguish between:

1. a correction of an earlier false statement,
2. a real change over time,
3. historical information that is still useful.

For example, "I no longer use X; I now use Y" is usually a state change, not evidence that the historical use of X was false.

Preserve dates or temporal wording when they are necessary to understand such changes.

## Safe patch behavior

`patch(ref, old, new)` should use exact or otherwise strongly validated matching.

If `old` does not match the current memory contents, fail the operation and require the agent to `read` the memory again before retrying.

Do not silently apply fuzzy edits to stale content. This makes concurrent or outdated updates detectable and reduces accidental memory corruption.

For removing one statement from a topic, use `patch(ref, old, "")`. Reserve `delete(ref)` mainly for deleting the whole topic.

## Deletion

Deletion should be conservative.

Delete an entire topic when:

* the user explicitly asks for it to be forgotten,
* the topic is clearly invalid,
* it is an accidental duplicate,
* or there is no reason for the topic itself to continue existing.

Do not delete old information merely because newer information exists when the historical information remains meaningful.

## Evidence and inference

Memory should primarily contain information supported by the conversation.

Direct user statements are strong evidence.

Do not turn uncertain assistant interpretations into user facts. For example, an assistant inference such as "the user probably dislikes X" should not become persistent memory unless there is sufficient explicit evidence.

Assistant-generated decisions or plans may be stored if they became part of the actual working state of an ongoing project.

## Memory contents

Prefer compact structured prose or bullets inside each topic.

Avoid two extremes:

* storing entire conversation transcripts,
* decomposing everything into tiny independent facts that lose their context.

A topic should contain enough context that another future conversation can understand what the information means without reopening the original conversation.

Keep memory concise and remove obsolete duplication during normal patches when appropriate.

## Metadata

The application, not the language model, should automatically maintain metadata such as:

* creation time
* last modification time
* revision/version
* stable topic reference

Do not ask the model to infer which revision is newest when the software already knows the ordering.

Prefer application-generated stable IDs rather than allowing the model to invent identifiers, if practical.

## Retrieval

`list` should be cheap and compact. It should primarily expose enough information to choose a topic, such as its reference and title, rather than returning the full contents of all memories.

The expected retrieval pattern is approximately:

`list -> grep/read relevant topics -> patch/new/delete if needed`

The model does not need to inspect every topic on every turn. It should search only when the completed conversation turn contains information that may affect persistent memory.

## Memory-maintenance instructions

The memory branch should be told explicitly that its role is to:

1. identify whether the completed turn contains durable information,
2. search relevant existing memory before writing,
3. preserve useful existing context,
4. resolve corrections and state changes carefully,
5. update an existing topic where possible,
6. create new topics sparingly,
7. delete conservatively,
8. perform no write when no useful update is needed.

Do not force a tool call every turn.

The goal is not to maximize how much information is remembered. The goal is to maintain a small, accurate, coherent, and useful long-term state that future conversations can retrieve.
