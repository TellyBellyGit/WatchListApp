// ============================================================================
// FIREBASE STORAGE WRAPPER — Image upload/download for Trade Reviews
// ============================================================================
// Uses Firebase Storage to persist pasted images. Images are resized
// client-side before upload (max 1200px wide, JPEG quality 0.8).
// ============================================================================

class ImageStorage {
  constructor() {
    this._storage = null;
    this._basePath = 'trade-images';
  }

  // ---- Lazy-init Firebase Storage ----
  _getStorage() {
    if (this._storage) return this._storage;

    if (typeof firebase === 'undefined') {
      console.warn('[ImageStorage] Firebase SDK not loaded');
      return null;
    }

    try {
      this._storage = firebase.storage();
      return this._storage;
    } catch (e) {
      console.warn('[ImageStorage] Failed to init Firebase Storage:', e.message);
      return null;
    }
  }

  // ---- Resize image client-side before upload ----
  _resizeImage(blob, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
      // Only resize if it's an image
      if (!blob.type.startsWith('image/')) {
        resolve(blob);
        return;
      }

      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        // If image is already smaller than maxWidth, return original
        if (img.width <= maxWidth) {
          resolve(blob);
          return;
        }

        const ratio = maxWidth / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = Math.round(img.height * ratio);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (resizedBlob) => {
            if (resizedBlob) {
              resolve(resizedBlob);
            } else {
              resolve(blob); // fallback to original
            }
          },
          'image/jpeg',
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(blob); // fallback to original
      };

      img.src = url;
    });
  }

  // ---- Upload an image, returns download URL ----
  async uploadImage(blob, reviewId) {
    // Resize before upload
    const resized = await this._resizeImage(blob);

    const storage = this._getStorage();
    const timestamp = Date.now();
    const ext = resized.type === 'image/png' ? 'png' : 'jpg';
    const filename = `${timestamp}.${ext}`;
    const path = `${this._basePath}/${reviewId}/${filename}`;

    if (!storage) {
      throw new Error('Firebase Storage unavailable — SDK not loaded');
    }

    const ref = storage.ref(path);
    await ref.put(resized, {
      contentType: resized.type || 'image/jpeg',
      cacheControl: 'public, max-age=31536000'
    });
    const downloadUrl = await ref.getDownloadURL();
    console.log('[ImageStorage] Uploaded:', path);
    return downloadUrl;
  }

  // ---- Delete an image from storage ----
  async deleteImage(url) {
    const storage = this._getStorage();
    if (!storage) return;

    // Only attempt to delete if it's a Firebase Storage URL
    if (!url.includes('firebasestorage.googleapis.com')) return;

    try {
      const ref = storage.refFromURL(url);
      await ref.delete();
      console.log('[ImageStorage] Deleted:', url);
    } catch (e) {
      console.warn('[ImageStorage] Delete failed:', e.message);
    }
  }

  // ---- Delete all images for a review ----
  async deleteReviewImages(reviewId) {
    const storage = this._getStorage();
    if (!storage) return;

    try {
      const folderRef = storage.ref(`${this._basePath}/${reviewId}`);
      const result = await folderRef.listAll();
      const deletePromises = result.items.map(item => item.delete());
      await Promise.all(deletePromises);
      console.log(`[ImageStorage] Deleted ${result.items.length} images for review ${reviewId}`);
    } catch (e) {
      console.warn('[ImageStorage] Failed to delete review images:', e.message);
    }
  }

  // ---- Convert blob to data URI (fallback) ----
  _toDataUri(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---- Download an image as a blob (for ZIP export) ----
  async downloadImageAsBlob(url) {
    // Handle data URIs
    if (url.startsWith('data:')) {
      const response = await fetch(url);
      return response.blob();
    }

    // Handle Firebase Storage URLs
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    } catch (e) {
      console.warn('[ImageStorage] Failed to download image:', url, e.message);
      return null;
    }
  }
}

// Global singleton
const imageStorage = new ImageStorage();