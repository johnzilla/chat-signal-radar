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

/// Main entry point: cluster messages into labeled buckets
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
        
        if text_lower.contains('?') || text_lower.contains("how") || text_lower.contains("what") || text_lower.contains("why") {
            questions.push(msg.text.clone());
        } else if text_lower.contains("bug") || text_lower.contains("error") || text_lower.contains("broken") || text_lower.contains("issue") {
            issues.push(msg.text.clone());
        } else if text_lower.contains("please") || text_lower.contains("can you") || text_lower.contains("could you") {
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
