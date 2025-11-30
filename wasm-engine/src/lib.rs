use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Message {
    pub text: String,
    pub author: String,
    pub timestamp: f64,
}

#[derive(Serialize, Deserialize)]
pub struct ClusterBucket {
    pub label: String,
    pub count: usize,
    pub sample_messages: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ClusterResult {
    pub buckets: Vec<ClusterBucket>,
    pub processed_count: usize,
}

/// Clusters chat messages into labeled buckets (Questions, Issues, Requests, General Chat).
///
/// # Input JSON Shape
/// 
/// Array of message objects:
/// ```json
/// [
///   {
///     "text": "How do I install this?",
///     "author": "user123",
///     "timestamp": 1638360000000
///   }
/// ]
/// ```
///
/// # Output JSON Shape
///
/// ```json
/// {
///   "buckets": [
///     {
///       "label": "Questions",
///       "count": 5,
///       "sample_messages": ["How do I...", "What is...", "Why does..."]
///     }
///   ],
///   "processed_count": 10
/// }
/// ```
///
/// # Clustering Rules (v0)
///
/// - **Questions**: Contains `?` or keywords: `how`, `what`, `why`
/// - **Issues/Bugs**: Keywords: `bug`, `error`, `broken`, `issue`
/// - **Requests**: Keywords: `please`, `can you`, `could you`, `would you`
/// - **General Chat**: Everything else
///
/// Returns up to 3 sample messages per bucket.
#[wasm_bindgen]
pub fn cluster_messages(messages_json: JsValue) -> Result<JsValue, JsValue> {
    // Parse incoming messages
    let messages: Vec<Message> = serde_wasm_bindgen::from_value(messages_json)
        .map_err(|e| JsValue::from_str(&format!("Parse error: {}", e)))?;

    // Simple keyword-based clustering (v0 implementation)
    let mut questions = Vec::new();
    let mut issues = Vec::new();
    let mut requests = Vec::new();
    let mut general = Vec::new();

    for msg in messages.iter() {
        let text_lower = msg.text.to_lowercase();
        
        if text_lower.contains('?') || text_lower.contains("how ") || text_lower.contains("what ") || text_lower.contains("why ") {
            questions.push(msg.text.clone());
        } else if text_lower.contains("bug") || text_lower.contains("error") || text_lower.contains("broken") || text_lower.contains("issue") {
            issues.push(msg.text.clone());
        } else if text_lower.contains("please") || text_lower.contains("can you") || text_lower.contains("could you") || text_lower.contains("would you") {
            requests.push(msg.text.clone());
        } else {
            general.push(msg.text.clone());
        }
    }

    let mut buckets = Vec::new();

    if !questions.is_empty() {
        buckets.push(ClusterBucket {
            label: "Questions".to_string(),
            count: questions.len(),
            sample_messages: questions.into_iter().take(3).collect(),
        });
    }

    if !issues.is_empty() {
        buckets.push(ClusterBucket {
            label: "Issues/Bugs".to_string(),
            count: issues.len(),
            sample_messages: issues.into_iter().take(3).collect(),
        });
    }

    if !requests.is_empty() {
        buckets.push(ClusterBucket {
            label: "Requests".to_string(),
            count: requests.len(),
            sample_messages: requests.into_iter().take(3).collect(),
        });
    }

    if !general.is_empty() {
        buckets.push(ClusterBucket {
            label: "General Chat".to_string(),
            count: general.len(),
            sample_messages: general.into_iter().take(3).collect(),
        });
    }

    let result = ClusterResult {
        buckets,
        processed_count: messages.len(),
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_message(text: &str) -> Message {
        Message {
            text: text.to_string(),
            author: "TestUser".to_string(),
            timestamp: 0.0,
        }
    }

    #[test]
    fn test_question_clustering() {
        let messages = vec![
            create_test_message("How do I do this?"),
            create_test_message("What is the answer?"),
            create_test_message("Why does this happen?"),
            create_test_message("Just a regular message"),
        ];

        let result = cluster_messages_internal(&messages);

        // Should have Questions and General Chat buckets
        assert!(result.buckets.iter().any(|b| b.label == "Questions"));
        
        let questions_bucket = result.buckets.iter().find(|b| b.label == "Questions").unwrap();
        assert_eq!(questions_bucket.count, 3);
    }

    #[test]
    fn test_issue_clustering() {
        let messages = vec![
            create_test_message("This is broken!"),
            create_test_message("I found a bug in the system"),
            create_test_message("Error when loading"),
            create_test_message("Everything works great"),
        ];

        let result = cluster_messages_internal(&messages);

        let issues_bucket = result.buckets.iter().find(|b| b.label == "Issues/Bugs");
        assert!(issues_bucket.is_some());
        assert_eq!(issues_bucket.unwrap().count, 3);
    }

    #[test]
    fn test_request_clustering() {
        let messages = vec![
            create_test_message("Please help me"),
            create_test_message("Could you check this"),
            create_test_message("Thanks for streaming"),
        ];

        let result = cluster_messages_internal(&messages);

        let requests_bucket = result.buckets.iter().find(|b| b.label == "Requests");
        assert!(requests_bucket.is_some(), "Requests bucket should exist");
        let count = requests_bucket.unwrap().count;
        assert!(count >= 2, "Expected at least 2 requests, got {}", count);
    }

    #[test]
    fn test_sample_messages_limit() {
        let messages = vec![
            create_test_message("Question 1?"),
            create_test_message("Question 2?"),
            create_test_message("Question 3?"),
            create_test_message("Question 4?"),
            create_test_message("Question 5?"),
        ];

        let result = cluster_messages_internal(&messages);

        let questions_bucket = result.buckets.iter().find(|b| b.label == "Questions").unwrap();
        assert_eq!(questions_bucket.count, 5);
        assert_eq!(questions_bucket.sample_messages.len(), 3); // Should only show 3 samples
    }

    #[test]
    fn test_general_chat_only() {
        let messages = vec![
            create_test_message("Hello everyone"),
            create_test_message("Great stream today"),
            create_test_message("Thanks for the content"),
            create_test_message("Keep up the good work"),
        ];

        let result = cluster_messages_internal(&messages);

        // Should only have General Chat bucket
        assert_eq!(result.buckets.len(), 1);
        let general_bucket = result.buckets.iter().find(|b| b.label == "General Chat");
        assert!(general_bucket.is_some());
        assert_eq!(general_bucket.unwrap().count, 4);

        // Ensure no other buckets exist
        assert!(result.buckets.iter().find(|b| b.label == "Questions").is_none());
        assert!(result.buckets.iter().find(|b| b.label == "Issues/Bugs").is_none());
        assert!(result.buckets.iter().find(|b| b.label == "Requests").is_none());
    }

    // Internal function for testing (not exposed to WASM)
    fn cluster_messages_internal(messages: &[Message]) -> ClusterResult {
        let mut questions = Vec::new();
        let mut issues = Vec::new();
        let mut requests = Vec::new();
        let mut general = Vec::new();

        for msg in messages.iter() {
            let text_lower = msg.text.to_lowercase();
            
            if text_lower.contains('?') || text_lower.contains("how ") || text_lower.contains("what ") || text_lower.contains("why ") {
                questions.push(msg.text.clone());
            } else if text_lower.contains("bug") || text_lower.contains("error") || text_lower.contains("broken") || text_lower.contains("issue") {
                issues.push(msg.text.clone());
            } else if text_lower.contains("please") || text_lower.contains("can you") || text_lower.contains("could you") || text_lower.contains("would you") {
                requests.push(msg.text.clone());
            } else {
                general.push(msg.text.clone());
            }
        }

        let mut buckets = Vec::new();

        if !questions.is_empty() {
            buckets.push(ClusterBucket {
                label: "Questions".to_string(),
                count: questions.len(),
                sample_messages: questions.into_iter().take(3).collect(),
            });
        }

        if !issues.is_empty() {
            buckets.push(ClusterBucket {
                label: "Issues/Bugs".to_string(),
                count: issues.len(),
                sample_messages: issues.into_iter().take(3).collect(),
            });
        }

        if !requests.is_empty() {
            buckets.push(ClusterBucket {
                label: "Requests".to_string(),
                count: requests.len(),
                sample_messages: requests.into_iter().take(3).collect(),
            });
        }

        if !general.is_empty() {
            buckets.push(ClusterBucket {
                label: "General Chat".to_string(),
                count: general.len(),
                sample_messages: general.into_iter().take(3).collect(),
            });
        }

        ClusterResult {
            buckets,
            processed_count: messages.len(),
        }
    }
}
