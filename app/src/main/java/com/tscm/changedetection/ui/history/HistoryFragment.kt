package com.tscm.changedetection.ui.history

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.tscm.changedetection.MainActivity
import com.tscm.changedetection.TscmViewModel
import com.tscm.changedetection.databinding.FragmentHistoryBinding
import com.tscm.changedetection.databinding.ItemHistoryCardBinding
import com.tscm.changedetection.db.AnalysisEntity
import com.tscm.changedetection.db.AppDatabase
import java.io.File
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

class HistoryFragment : Fragment() {

    private var _binding: FragmentHistoryBinding? = null
    private val binding get() = _binding!!

    private val viewModel: TscmViewModel by activityViewModels()
    private val db by lazy { AppDatabase.getDatabase(requireContext()) }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentHistoryBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val adapter = HistoryAdapter(
            lifecycleScope = viewLifecycleOwner.lifecycleScope,
            onDelete = { entity ->
                lifecycleScope.launch { db.analysisDao().deleteById(entity.id) }
            },
            onSelect = { entity ->
                viewModel.loadFromHistory(requireContext(), entity)
                // Navigate back to Analysis (or Comparison) via the bottom nav
                (activity as? MainActivity)?.findViewById<View>(com.tscm.changedetection.R.id.analysisFragment)?.performClick()
            }
        )

        binding.recyclerHistory.layoutManager = LinearLayoutManager(requireContext())
        binding.recyclerHistory.adapter = adapter

        lifecycleScope.launch {
            db.analysisDao().getAllHistory().collectLatest { history ->
                adapter.submitList(history)
                binding.txtEmpty.visibility = if (history.isEmpty()) View.VISIBLE else View.GONE
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}

class HistoryAdapter(
    private val lifecycleScope: androidx.lifecycle.LifecycleCoroutineScope,
    private val onDelete: (AnalysisEntity) -> Unit,
    private val onSelect: (AnalysisEntity) -> Unit
) : RecyclerView.Adapter<HistoryAdapter.ViewHolder>() {

    private var items = listOf<AnalysisEntity>()
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())

    fun submitList(newItems: List<AnalysisEntity>) {
        items = newItems
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemHistoryCardBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        holder.bind(item)
    }

    override fun getItemCount(): Int = items.size

    inner class ViewHolder(private val itemBinding: ItemHistoryCardBinding) : RecyclerView.ViewHolder(itemBinding.root) {
        private var job: kotlinx.coroutines.Job? = null

        fun bind(item: AnalysisEntity) {
            job?.cancel() // Cancel previous load if any
            itemBinding.txtHistoryLabel.text = item.label
            itemBinding.txtHistoryDate.text = dateFormat.format(Date(item.timestamp))
            itemBinding.txtHistoryStats.text = String.format("Change: %.2f%% | Regions: %d", item.changedPct, item.regions)
            
            itemBinding.imgHistoryThumb.setImageBitmap(null)

            val context = itemBinding.root.context
            val fileName = item.resultFileName ?: item.beforeFileName
            val file = File(context.filesDir, fileName)

            if (file.exists()) {
                job = lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                    val bitmap = decodeSampledBitmap(file, 150, 150)
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        itemBinding.imgHistoryThumb.setImageBitmap(bitmap)
                    }
                }
            }

            itemBinding.btnDelete.setOnClickListener { onDelete(item) }
            itemBinding.root.setOnClickListener { onSelect(item) }
        }

        private fun decodeSampledBitmap(file: File, reqWidth: Int, reqHeight: Int): android.graphics.Bitmap? {
            val options = android.graphics.BitmapFactory.Options().apply {
                inJustDecodeBounds = true
            }
            android.graphics.BitmapFactory.decodeFile(file.absolutePath, options)
            
            options.inSampleSize = calculateInSampleSize(options, reqWidth, reqHeight)
            options.inJustDecodeBounds = false
            return android.graphics.BitmapFactory.decodeFile(file.absolutePath, options)
        }

        private fun calculateInSampleSize(options: android.graphics.BitmapFactory.Options, reqWidth: Int, reqHeight: Int): Int {
            val (height: Int, width: Int) = options.run { outHeight to outWidth }
            var inSampleSize = 1
            if (height > reqHeight || width > reqWidth) {
                val halfHeight: Int = height / 2
                val halfWidth: Int = width / 2
                while (halfHeight / inSampleSize >= reqHeight && halfWidth / inSampleSize >= reqWidth) {
                    inSampleSize *= 2
                }
            }
            return inSampleSize
        }
    }
}

